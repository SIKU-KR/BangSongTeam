import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  BACKGROUND_SNIFF_BYTES,
  BackgroundIdParamSchema,
  BackgroundUploadFormSchema,
  createId,
  isBackgroundImageMimeType,
  isBackgroundVideoMimeType,
  sniffBackgroundMimeType,
  userBackgroundKeys,
  type BackgroundImageMimeType,
  type BackgroundMimeType,
} from "#shared";
import {
  createD1Client,
  deleteUserBackground,
  getBackgroundUsage,
  insertUserBackground,
  listVisibleBackgrounds,
} from "#db";
import type { AppEnv } from "../types";
import {
  resolveOptionalSession,
  resolveRequireAuth,
  type AppDeps,
} from "../deps";

async function sniff(file: File): Promise<BackgroundMimeType | null> {
  const head = await file.slice(0, BACKGROUND_SNIFF_BYTES).arrayBuffer();
  return sniffBackgroundMimeType(new Uint8Array(head));
}

function sameKind(declared: string, actual: BackgroundMimeType): boolean {
  return isBackgroundVideoMimeType(declared)
    ? isBackgroundVideoMimeType(actual)
    : isBackgroundImageMimeType(actual);
}

/**
 * 배경 라이브러리 API.
 *
 * 목록은 로그인 없이 열리고(사전 주입 배경), 로그인하면 내 업로드와 저장 공간
 * 사용량이 더해진다. 업로드·삭제는 소유자 본인만 한다. 남의 커스텀 배경은 어떤
 * 경로로도 보이지 않는다 (쿼리 헬퍼가 범위를 고정한다).
 *
 * 업로드는 R2에 먼저 쓰고 D1 행을 나중에 만든다. 반대 순서면 파일 없는 행이 생겨
 * 편집기·송출이 깨진 배경을 그린다. 행 삽입이 실패하면 올린 객체를 지운다.
 */
export function createBackgroundsRoute(deps: AppDeps = {}) {
  const requireAuth = resolveRequireAuth(deps);
  const optionalSession = resolveOptionalSession(deps);

  return new Hono<AppEnv>()
    .get("/", optionalSession, async (c) => {
      const userId = c.get("userId") ?? null;
      const db = createD1Client(c.env.DB);
      const [backgrounds, usage] = await Promise.all([
        listVisibleBackgrounds(db, userId),
        userId ? getBackgroundUsage(db, userId) : Promise.resolve(null),
      ]);

      c.header("cache-control", "private, no-cache");
      return c.json({ backgrounds, usage }, 200);
    })
    .post(
      "/uploads",
      requireAuth,
      zValidator("form", BackgroundUploadFormSchema, (result, c) => {
        if (!result.success) {
          return c.json(
            {
              error:
                result.error.issues[0]?.message ??
                "업로드 형식이 올바르지 않습니다",
            },
            400,
          );
        }
      }),
      async (c) => {
        const userId = c.get("userId") as string;
        const form = c.req.valid("form");

        const mediaMime = await sniff(form.file);
        if (!mediaMime || !sameKind(form.file.type, mediaMime)) {
          return c.json(
            {
              error:
                "파일 내용을 읽을 수 없습니다. MP4 영상이나 JPEG·PNG·WebP 이미지인지 확인해 주세요",
            },
            400,
          );
        }

        const kind = isBackgroundVideoMimeType(mediaMime) ? "video" : "image";
        let posterMime: BackgroundImageMimeType | null = null;
        if (kind === "video" && form.poster) {
          const sniffed = await sniff(form.poster);
          if (!sniffed || !isBackgroundImageMimeType(sniffed)) {
            return c.json({ error: "포스터 이미지를 읽을 수 없습니다" }, 400);
          }
          posterMime = sniffed;
        }
        const poster = kind === "video" ? form.poster : undefined;

        const db = createD1Client(c.env.DB);
        const addedBytes = form.file.size + (poster?.size ?? 0);
        const usage = await getBackgroundUsage(db, userId);
        if (usage.usedBytes + addedBytes > usage.limitBytes) {
          return c.json(
            {
              error:
                "저장 공간(300MB)을 넘습니다. 쓰지 않는 배경을 지운 뒤 다시 올려 주세요",
            },
            413,
          );
        }

        const id = createId();
        const { mediaKey, posterKey } = userBackgroundKeys(
          userId,
          id,
          mediaMime,
          posterMime,
        );
        const uploadedKeys = [mediaKey];
        await c.env.MEDIA_BUCKET.put(mediaKey, form.file, {
          httpMetadata: { contentType: mediaMime },
        });
        if (poster && posterMime) {
          await c.env.MEDIA_BUCKET.put(posterKey, poster, {
            httpMetadata: { contentType: posterMime },
          });
          uploadedKeys.push(posterKey);
        }

        let background;
        try {
          background = await insertUserBackground(db, userId, {
            id,
            title: form.title,
            kind,
            mediaKey,
            posterKey,
            sizeBytes: addedBytes,
            durationSec: kind === "video" ? form.durationSec : 0,
            tags: form.tags,
          });
        } catch (error) {
          await c.env.MEDIA_BUCKET.delete(uploadedKeys);
          throw error;
        }

        return c.json(
          {
            background,
            usage: { ...usage, usedBytes: usage.usedBytes + addedBytes },
          },
          201,
        );
      },
    )
    .delete(
      "/uploads/:id",
      requireAuth,
      zValidator("param", BackgroundIdParamSchema),
      async (c) => {
        const userId = c.get("userId") as string;
        const db = createD1Client(c.env.DB);

        const keys = await deleteUserBackground(
          db,
          userId,
          c.req.valid("param").id,
        );
        if (!keys) {
          return c.json({ error: "배경을 찾을 수 없습니다" }, 404);
        }

        try {
          await c.env.MEDIA_BUCKET.delete([
            ...new Set([keys.mediaKey, keys.posterKey]),
          ]);
        } catch (error) {
          console.error("background object delete failed", { keys, error });
        }

        return c.json(
          { ok: true as const, usage: await getBackgroundUsage(db, userId) },
          200,
        );
      },
    );
}
