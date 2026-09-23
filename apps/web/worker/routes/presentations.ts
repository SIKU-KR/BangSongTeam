import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { PresentationDocumentSchema } from "@repo/shared";
import {
  createD1Client,
  getPresentationDocumentsByUserId,
  upsertPresentationDocument,
  deletePresentation,
} from "@repo/db";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";

/**
 * 프레젠테이션 문서 동기화 API.
 *
 * 로컬 IndexedDB가 문서 1건을 통째로 put하는 것과 같은 단위로 주고받는다.
 * `userId`는 언제나 세션에서 가져오고 본문 값은 신뢰하지 않는다 (D1에 RLS 없음).
 */
const presentationsRoute = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createD1Client(c.env.DB);
    const documents = await getPresentationDocumentsByUserId(
      db,
      c.get("userId") as string,
    );
    return c.json({ presentations: documents }, 200);
  })
  .put("/:id", zValidator("json", PresentationDocumentSchema), async (c) => {
    const userId = c.get("userId") as string;
    const document = c.req.valid("json");

    // 경로와 본문이 어긋나면 어느 문서를 쓰는지 모호해진다.
    if (document.id !== c.req.param("id")) {
      return c.json({ error: "문서 id가 경로와 일치하지 않습니다" }, 400);
    }

    const db = createD1Client(c.env.DB);

    // DB 오류를 그냥 던지면 raw D1_ERROR가 500 본문으로 새어 나가고, 클라이언트는
    // '서버가 요청을 거절했습니다 (500)'만 보게 된다. 원인을 서버 로그에 남기고
    // 사용자에게는 무엇이 안 됐는지 읽을 수 있는 문장을 준다.
    try {
      const saved = await upsertPresentationDocument(db, userId, document);
      if (!saved) {
        return c.json({ error: "이 프레젠테이션에 접근할 수 없습니다" }, 403);
      }
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
    const db = createD1Client(c.env.DB);
    const removed = await deletePresentation(
      db,
      c.req.param("id"),
      c.get("userId") as string,
    );

    if (!removed) {
      return c.json({ error: "이 프레젠테이션에 접근할 수 없습니다" }, 404);
    }
    return c.json({ ok: true as const }, 200);
  });

export { presentationsRoute };
export default presentationsRoute;
