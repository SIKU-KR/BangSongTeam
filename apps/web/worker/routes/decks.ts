import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DeckSchema } from "@repo/shared";
import {
  createD1Client,
  getMyLibraryDecks,
  upsertDeck,
  deleteDeckScoped,
  toSharedDeck,
} from "@repo/db";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";

/**
 * 곡 보관함(scope: 'library') 동기화 API.
 *
 * 프레젠테이션에 속한 덱은 프레젠테이션 문서에 임베드되어 함께 저장되므로
 * 여기서는 다루지 않는다 (`/api/presentations`).
 */
const decksRoute = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const db = createD1Client(c.env.DB);
    const rows = await getMyLibraryDecks(db, c.get("userId") as string);
    return c.json({ decks: rows.map(toSharedDeck) }, 200);
  })
  .put("/:id", zValidator("json", DeckSchema), async (c) => {
    const userId = c.get("userId") as string;
    const deck = c.req.valid("json");

    if (deck.id !== c.req.param("id")) {
      return c.json({ error: "덱 id가 경로와 일치하지 않습니다" }, 400);
    }

    const db = createD1Client(c.env.DB);
    const saved = await upsertDeck(db, userId, deck);
    if (!saved) {
      return c.json({ error: "이 곡에 접근할 수 없습니다" }, 403);
    }

    return c.json({ ok: true as const }, 200);
  })
  .delete("/:id", async (c) => {
    const db = createD1Client(c.env.DB);
    const removed = await deleteDeckScoped(
      db,
      c.req.param("id"),
      c.get("userId") as string,
    );

    if (!removed) {
      return c.json({ error: "이 곡에 접근할 수 없습니다" }, 404);
    }
    return c.json({ ok: true as const }, 200);
  });

export { decksRoute };
export default decksRoute;
