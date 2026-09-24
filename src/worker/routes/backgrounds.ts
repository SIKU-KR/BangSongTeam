import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  BACKGROUND_SNIFF_BYTES,
  BackgroundIdParamSchema,
  BackgroundUploadFormSchema,
  createId,
  isBackgroundImageMimeType,
  isBackgroundVideoMimeType,
  serviceBackgroundKeys,
  sniffBackgroundMimeType,
  type BackgroundImageMimeType,
  type BackgroundMimeType,
} from "#shared";
import {
  createD1Client,
  deleteServiceBackground,
  insertServiceBackground,
  listBackgrounds,
} from "#db";
import type { AppEnv } from "../types";
import { isAdminUser } from "../lib/auth";
import { requireAdmin } from "../middleware/auth";
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
 * 배경 갤러리 API.
 *
 * 목록은 로그인 없이 열리고 모두에게 같다(기본 제공 배경). 올리기·지우기는
 * 관리자(`ADMIN_USER_IDS`)만 하고, 올린 배경은 곧바로 기본 제공 배경이 된다.
 *
 * 업로드는 R2에 먼저 쓰고 D1 행을 나중에 만든다. 반대 순서면 파일 없는 행이 생겨
 * 편집기·송출이 깨진 배경을 그린다. 행 삽입이 실패하면 올린 객체를 지운다.
 * 삭제는 거꾸로 행을 먼저 지우고 R2 객체를 나중에 지운다.
 */
export function createBackgroundsRoute(deps: AppDeps = {}) {
  const requireAuth = resolveRequireAuth(deps);
  const optionalSession = resolveOptionalSession(deps);

  return new Hono<AppEnv>()
    .get("/", optionalSession, async (c) => {
      const backgrounds = await listBackgrounds(createD1Client(c.env.DB));
      const canManage = isAdminUser(c.env, c.get("userId"));

      c.header("cache-control", "private, no-cache");
      return c.json({ backgrounds, canManage }, 200);
    })
    .post(
      "/uploads",
      requireAuth,
      requireAdmin,
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
        const id = createId();
        const { mediaKey, posterKey } = serviceBackgroundKeys(
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
          background = await insertServiceBackground(db, {
            id,
            title: form.title,
            license: form.license,
            kind,
            mediaKey,
            posterKey,
            sizeBytes: form.file.size + (poster?.size ?? 0),
            durationSec: kind === "video" ? form.durationSec : 0,
            tags: form.tags,
          });
        } catch (error) {
          await c.env.MEDIA_BUCKET.delete(uploadedKeys);
          throw error;
        }

        return c.json({ background }, 201);
      },
    )
    .delete(
      "/uploads/:id",
      requireAuth,
      requireAdmin,
      zValidator("param", BackgroundIdParamSchema),
      async (c) => {
        const keys = await deleteServiceBackground(
          createD1Client(c.env.DB),
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

        return c.json({ ok: true as const }, 200);
      },
    );
}
