import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";

/** 저장된 미디어 객체의 메타데이터 */
export interface MediaObject {
  size: number;
  /** 응답 `etag` 헤더 값 (따옴표 포함) */
  etag: string;
  contentType: string;
  /** 읽기를 이 판으로 고정하는 값. GCS면 generation이다 */
  version: string;
}

/** 바이트 구간 (양 끝 포함) */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * 배경 영상·포스터 저장소. 미디어 라우트는 `stat`으로 크기와 판을 확인하고 `read`로 그
 * 판의 구간만 흘려보낸다. 객체는 키마다 한 번 올리고 바꾸지 않는다(배경 id가 키에 든다).
 */
export interface MediaStore {
  stat(key: string): Promise<MediaObject | null>;
  read(
    key: string,
    object: MediaObject,
    range?: ByteRange,
  ): ReadableStream<Uint8Array>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
};

function contentTypeOf(key: string): string {
  return (
    CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream"
  );
}

function isNotFound(error: unknown): boolean {
  const err = error as { code?: unknown } | null;
  return err?.code === 404 || err?.code === "ENOENT" || err?.code === "EISDIR";
}

/** Cloud Storage 버킷. Cloud Run 서비스 계정의 자격으로 읽는다 */
export function createGcsMediaStore(bucketName: string): MediaStore {
  const bucket = new Storage().bucket(bucketName);
  return {
    async stat(key) {
      try {
        const [metadata] = await bucket.file(key).getMetadata();
        return {
          size: Number(metadata.size ?? 0),
          etag: `"${metadata.etag ?? metadata.generation}"`,
          contentType: metadata.contentType ?? contentTypeOf(key),
          version: String(metadata.generation ?? ""),
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    read(key, object, range) {
      const file = bucket.file(
        key,
        object.version ? { generation: Number(object.version) } : {},
      );
      return Readable.toWeb(
        file.createReadStream({
          validation: false,
          ...(range ? { start: range.start, end: range.end } : {}),
        }),
      ) as ReadableStream<Uint8Array>;
    },
  };
}

/**
 * 로컬 폴더(`pnpm dev`·`pnpm start`용). 키는 폴더 안의 상대 경로이고, 폴더 밖을 가리키는
 * 키(`..`)는 없는 객체로 본다.
 */
export function createFileMediaStore(root: string): MediaStore {
  const base = path.resolve(root);
  const resolve = (key: string): string | null => {
    const file = path.resolve(base, key);
    return file.startsWith(`${base}${path.sep}`) ? file : null;
  };
  return {
    async stat(key) {
      const file = resolve(key);
      if (!file) return null;
      try {
        const info = await stat(file);
        if (!info.isFile()) return null;
        return {
          size: info.size,
          etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
          contentType: contentTypeOf(key),
          version: String(info.mtimeMs),
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    read(key, _object, range) {
      return Readable.toWeb(
        createReadStream(resolve(key) as string, range ?? {}),
      ) as ReadableStream<Uint8Array>;
    },
  };
}

/** 테스트용 메모리 저장소 */
export function createMemoryMediaStore(): MediaStore & {
  put(key: string, bytes: Uint8Array, contentType?: string): void;
} {
  const objects = new Map<string, { bytes: Uint8Array; object: MediaObject }>();
  let version = 0;
  return {
    put(key, bytes, contentType = contentTypeOf(key)) {
      version += 1;
      objects.set(key, {
        bytes,
        object: {
          size: bytes.byteLength,
          etag: `"v${version}"`,
          contentType,
          version: String(version),
        },
      });
    },
    async stat(key) {
      return objects.get(key)?.object ?? null;
    },
    read(key, _object, range) {
      const bytes = objects.get(key)?.bytes ?? new Uint8Array();
      const slice = range ? bytes.slice(range.start, range.end + 1) : bytes;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        },
      });
    },
  };
}

/**
 * 환경 변수로 저장소를 고른다. `MEDIA_BUCKET`이 있으면 그 GCS 버킷, 없으면 `MEDIA_DIR`
 * (기본 `.data/media`) 폴더다. 운영에서는 `MEDIA_BUCKET`을 반드시 넣는다.
 */
export function createMediaStore(
  env: Record<string, string | undefined>,
): MediaStore {
  if (env.MEDIA_BUCKET) return createGcsMediaStore(env.MEDIA_BUCKET);
  return createFileMediaStore(env.MEDIA_DIR ?? path.join(".data", "media"));
}
