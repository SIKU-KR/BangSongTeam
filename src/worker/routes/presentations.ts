import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  PresentationDocumentSchema,
  UpdateShareSettingsRequestSchema,
} from "#shared";
import {
  createD1Client,
  deletePresentation,
  getPresentationDocument,
  getPresentationDocumentsByUserId,
  getShareSettings,
  getSharedPresentationDocuments,
  resetLinkToken,
  setLinkAccess,
  upsertPresentationDocument,
} from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

const NOT_ACCESSIBLE = "이 프레젠테이션에 접근할 수 없습니다";

/**
 * 프레젠테이션 문서 동기화 API.
 *
 * 로컬 IndexedDB가 문서 1건을 통째로 put하는 것과 같은 단위로 주고받는다.
 * `userId`는 언제나 세션에서 가져오고 본문 값은 신뢰하지 않는다 (D1에 RLS 없음).
 * 목록·단건 조회에는 링크로 공유받은 세트(`access`가 붙음, 보기 전용)도 온다.
 * 저장은 소유자만 할 수 있다.
 */
export function createPresentationsRoute(deps: AppDeps = {}) {
  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .get("/", async (c) => {
      const db = createD1Client(c.env.DB);
      const userId = c.get("userId") as string;
      const [own, shared] = await Promise.all([
        getPresentationDocumentsByUserId(db, userId),
        getSharedPresentationDocuments(db, userId),
      ]);
      return c.json({ presentations: [...own, ...shared] }, 200);
    })
    .get("/:id", async (c) => {
      const db = createD1Client(c.env.DB);
      const document = await getPresentationDocument(
        db,
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!document) return c.json({ error: NOT_ACCESSIBLE }, 404);
      return c.json({ presentation: document }, 200);
    })
    .put("/:id", zValidator("json", PresentationDocumentSchema), async (c) => {
      const userId = c.get("userId") as string;
      const document = c.req.valid("json");

      if (document.id !== c.req.param("id")) {
        return c.json({ error: "문서 id가 경로와 일치하지 않습니다" }, 400);
      }

      const db = createD1Client(c.env.DB);

      try {
        const saved = await upsertPresentationDocument(db, userId, document);
        if (!saved) return c.json({ error: NOT_ACCESSIBLE }, 403);
      } catch (error) {
        console.error("presentation upsert failed", {
          presentationId: document.id,
          songCount: document.items.length,
          error,
        });
        return c.json({ error: "프레젠테이션을 저장하지 못했습니다" }, 500);
      }

      return c.json({ ok: true as const }, 200);
    })
    .delete("/:id", async (c) => {
      const removed = await deletePresentation(
        createD1Client(c.env.DB),
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!removed) return c.json({ error: NOT_ACCESSIBLE }, 404);
      return c.json({ ok: true as const }, 200);
    })
    .get("/:id/share", async (c) => {
      const settings = await getShareSettings(
        createD1Client(c.env.DB),
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!settings) return c.json({ error: NOT_ACCESSIBLE }, 404);
      return c.json(settings, 200);
    })
    .put(
      "/:id/share",
      zValidator("json", UpdateShareSettingsRequestSchema),
      async (c) => {
        const settings = await setLinkAccess(
          createD1Client(c.env.DB),
          c.req.param("id"),
          c.get("userId") as string,
          c.req.valid("json").access,
        );
        if (!settings) return c.json({ error: NOT_ACCESSIBLE }, 404);
        return c.json(settings, 200);
      },
    )
    .post("/:id/share/reset", async (c) => {
      const settings = await resetLinkToken(
        createD1Client(c.env.DB),
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!settings) return c.json({ error: NOT_ACCESSIBLE }, 404);
      return c.json(settings, 200);
    });
}

export const presentationsRoute = createPresentationsRoute();
export default presentationsRoute;
