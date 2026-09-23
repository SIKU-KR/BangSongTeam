import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DeckSchema, VisibilityUpdateRequestSchema } from "@repo/shared";
import {
  createD1Client,
  getMyLibraryDecks,
  upsertDeck,
  deleteDeckScoped,
  toSharedDeck,
  contributeLyrics,
  shouldContribute,
  setDeckVisibility,
  forkPublicDeck,
} from "@repo/db";
import type { AppEnv } from "../types";
import { resolveModelRunner, resolveRequireAuth, type AppDeps } from "../deps";
import { normalizeCatalog } from "../lib/normalization";
import { runInBackground } from "../lib/background";

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
        // 세트 복제본은 프레젠테이션 문서로만 저장한다. 이 경로로 들어오면
        // 보관함 덱으로 둔갑하거나 반대로 세트 덱이 보관함 목록을 오염시킨다.
        if (deck.scope !== "library") {
          return c.json({ error: "보관함 곡만 저장할 수 있습니다" }, 400);
        }

        const db = createD1Client(c.env.DB);

        // 프레젠테이션 저장과 같은 이유로 DB 오류를 그대로 흘리지 않는다.
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

        // 가사 기여는 선택이다. 실패해도 덱 저장 자체를 되돌리지 않는다 —
        // 공용 카탈로그는 부가 기능이고, 여기서 500을 내면 사용자는 자기 곡이
        // 저장되지 않았다고 이해한다.
        //
        // 루트 버전 판정은 서버에 저장된 덱으로 한다. `origin`은 서버 소유라
        // 클라이언트가 포크본을 루트로 둔갑시킬 수 없다 (PRD 4.8).
        let contributed = false;
        if (shouldContribute(saved)) {
          try {
            const result = await contributeLyrics(db, {
              userId,
              deckId: saved.id,
              title: saved.title,
              artist: saved.artist,
              lyrics: saved.lyricsRaw,
              preferredCatalogId: deck.catalogId ?? null,
            });
            contributed = true;
            // 기여가 덱을 카탈로그에 묶었다. 응답 덱에 반영해 편집기가 바로 안다.
            saved = { ...saved, catalogId: result.catalogId };

            // 서로 다른 사용자의 루트 버전이 2개 이상이면 대표 가사를 다시 만든다
            // (PRD 4.8 정규화 시점). 같은 가사를 다시 저장한 것뿐이면 부르지 않는다.
            if (result.changed && result.versionCount >= 2 && !result.locked) {
              const runner = resolveModelRunner(deps, c.env);
              runInBackground(c, `normalize catalog ${result.catalogId}`, () =>
                normalizeCatalog(db, result.catalogId, runner),
              );
            }
          } catch (err) {
            console.error("가사 기여 실패:", err);
          }
        }

        // 서버가 확정한 공유 필드(공개 여부·가져간 횟수 등)를 클라이언트가 반영한다
        return c.json({ ok: true as const, deck: saved, contributed }, 200);
      })
      // 공개 전환 (PRD 4.7 공유 선택). 공개하려면 저작권 안내 동의가 `true`여야 한다.
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
      // 공개 덱 가져오기 (PRD 4.7). 원본은 바뀌지 않고 내 보관함에 비공개 복제본이 생긴다.
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
