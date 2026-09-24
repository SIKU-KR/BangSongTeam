import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DeckSchema, VisibilityUpdateRequestSchema } from "@repo/shared";
import {
  createD1Client,
  getMyLibraryDecks,
  upsertDeck,
  deleteDeckScoped,
  toSharedDeck,
  setDeckVisibility,
  forkPublicDeck,
} from "@repo/db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

/**
 * 곡 보관함(scope: 'library') 동기화 API.
 *
 * 프레젠테이션에 속한 덱은 프레젠테이션 문서에 임베드되어 함께 저장되므로
 * 여기서는 다루지 않는다 (`/api/presentations`).
 */
export function createDecksRoute(deps: AppDeps = {}) {
  return (
    new Hono<AppEnv>()
      .use("*", resolveRequireAuth(deps))
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
        if (deck.scope !== "library") {
          return c.json({ error: "보관함 곡만 저장할 수 있습니다" }, 400);
        }

        const db = createD1Client(c.env.DB);

        let saved;
        try {
          saved = await upsertDeck(db, userId, deck);
          if (!saved) {
            return c.json({ error: "이 곡에 접근할 수 없습니다" }, 403);
          }
        } catch (error) {
          console.error("deck upsert failed", { deckId: deck.id, error });
          return c.json({ error: "곡을 저장하지 못했습니다" }, 500);
        }

        return c.json({ ok: true as const, deck: saved }, 200);
      })
      .patch(
        "/:id/visibility",
        zValidator("json", VisibilityUpdateRequestSchema),
        async (c) => {
          const db = createD1Client(c.env.DB);
          const { visibility } = c.req.valid("json");
          const result = await setDeckVisibility(
            db,
            c.get("userId") as string,
            c.req.param("id"),
            visibility,
          );

          switch (result.status) {
            case "ok":
              return c.json({ deck: result.deck }, 200);
            case "not_found":
              return c.json({ error: "이 곡에 접근할 수 없습니다" }, 404);
            case "not_library":
              return c.json(
                { error: "세트에 담긴 곡은 보관함 원본으로 공개합니다" },
                400,
              );
            case "empty":
              return c.json(
                { error: "슬라이드가 없는 곡은 공개할 수 없습니다" },
                400,
              );
            case "taken_down":
              return c.json(
                {
                  error:
                    "운영자가 게시를 중단한 곡이라 다시 공개할 수 없습니다",
                },
                409,
              );
          }
        },
      )
      .post("/:id/fork", async (c) => {
        const db = createD1Client(c.env.DB);
        const result = await forkPublicDeck(
          db,
          c.get("userId") as string,
          c.req.param("id"),
        );
        if (result.status === "not_found") {
          return c.json({ error: "공개된 곡을 찾을 수 없습니다" }, 404);
        }
        return c.json(
          { deck: result.deck, alreadyOwned: result.alreadyOwned },
          200,
        );
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
      })
  );
}

export const decksRoute = createDecksRoute();
export default decksRoute;
