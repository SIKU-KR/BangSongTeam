import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { API_ERRORS, BackgroundIdParamSchema } from "#shared";
import { createD1Client, deleteServiceBackground, listBackgrounds } from "#db";
import type { AppEnv } from "../types";
import { isAdminUser } from "../lib/auth";
import { requireAdmin } from "../middleware/auth";
import {
  resolveOptionalSession,
  resolveRequireAuth,
  type AppDeps,
} from "../deps";

/**
 * 배경 갤러리 API.
 *
 * 목록은 로그인 없이 열리고 모두에게 같다(기본 제공 배경). 지우기는
 * 관리자(`ADMIN_USER_IDS`)만 한다.
 *
 * 등록은 앱에 없고 `scripts/importBackgrounds.mjs`로만 한다. 배경 영상은 최대
 * 수백 MB라 Worker 요청 본문 한도를 넘는다. 삭제는 행을 먼저 지우고 R2 객체를
 * 나중에 지운다 — 반대 순서면 파일 없는 행이 남아 편집기·송출이 깨진 배경을 그린다.
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
          return c.json({ error: API_ERRORS.background.notFound }, 404);
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
