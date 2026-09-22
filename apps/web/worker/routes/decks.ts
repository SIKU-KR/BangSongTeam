import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DeckSchema } from "@repo/shared";
import {
  createD1Client,
  getMyLibraryDecks,
  upsertDeck,
  deleteDeckScoped,
  toSharedDeck,
  contributeLyrics,
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

    // 프레젠테이션 저장과 같은 이유로 DB 오류를 그대로 흘리지 않는다.
    try {
      const saved = await upsertDeck(db, userId, deck);
      if (!saved) {
        return c.json({ error: "이 곡에 접근할 수 없습니다" }, 403);
      }
    } catch (error) {
      console.error("deck upsert failed", { deckId: deck.id, error });
      return c.json({ error: "곡을 저장하지 못했습니다" }, 500);
    }

    // 가사 기여는 선택이다. 실패해도 덱 저장 자체를 되돌리지 않는다 —
    // 공용 카탈로그는 부가 기능이고, 여기서 500을 내면 사용자는 자기 곡이
    // 저장되지 않았다고 이해한다.
    let contributed = false;
    if (c.req.query("contribute") === "true" && deck.lyricsRaw.trim()) {
      try {
        await contributeLyrics(db, {
          userId,
          deckId: deck.id,
          title: deck.title,
          artist: deck.artist,
          lyrics: deck.lyricsRaw,
        });
        contributed = true;
      } catch (err) {
        console.error("가사 기여 실패:", err);
      }
    }

    return c.json({ ok: true as const, contributed }, 200);
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
