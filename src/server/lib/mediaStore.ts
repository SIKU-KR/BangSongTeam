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

function openOnFirstRead(
  open: () => ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  let source: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        source ??= open().getReader();
        const { value, done } = await source.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return source?.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * Cloud Storage 버킷. Cloud Run 서비스 계정의 자격으로 읽는다.
 *
 * - 요청마다 `forever: false`로 라이브러리의 공용 keep-alive 에이전트를 쓰지 않는다.
 *   `createReadStream`은 내려받기가 오류로 끝나면 그 요청의 에이전트를 `destroy()`하는데
 *   (@google-cloud/storage `file.js` createReadStream의 `onComplete`), 기본값이면 그
 *   에이전트를 프로세스 전체가 나눠 쓴다. 그러면 영상 요청 하나가 끊길 때 같은 인스턴스의 다른
 *   내려받기도 모두 끊긴다. 라이브러리도 Cloud Functions에서는 같은 방법으로 끈다. Node 기본
 *   에이전트도 연결을 다시 쓰고, 끊긴 요청의 소켓만 닫는다.
 * - `read`는 본문을 처음 읽을 때 내려받기를 연다. HEAD 응답이나 `stat` 중에 떠난 요청처럼
 *   아무도 읽지 않고 버리는 본문이 내려받기를 열어 두면 취소되지 않고 소켓과 버퍼를 붙잡는다.
 */
export function createGcsMediaStore(bucketName: string): MediaStore {
  const bucket = new Storage({
    interceptors_: [
      {
        request: (reqOpts: { uri: string }) => ({ ...reqOpts, forever: false }),
      },
    ],
  }).bucket(bucketName);
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
      return openOnFirstRead(
        () =>
          Readable.toWeb(
            file.createReadStream({
              validation: false,
              ...(range ? { start: range.start, end: range.end } : {}),
            }),
          ) as ReadableStream<Uint8Array>,
      );
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
