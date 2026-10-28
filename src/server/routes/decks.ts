import { Hono, type Context } from "hono";
import {
  API_ERRORS,
  DeckWriteSchema,
  VisibilityUpdateRequestSchema,
} from "#shared";
import {
  getMyLibraryDecks,
  upsertDeck,
  deleteDeckScoped,
  toSharedDeck,
  setDeckVisibility,
  forkPublicDeck,
  type SetVisibilityResult,
} from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import {
  isStorageLimitError,
  isTransientStorageError,
} from "../lib/storageErrors";
import { logServerError } from "../lib/requestLog";
import { idParam } from "../lib/params";
import { jsonBody } from "../lib/jsonBody";
import { rejectOverLimit } from "../lib/writeLimits";
import {
  DECK_BODY_MAX_BYTES,
  SMALL_BODY_MAX_BYTES,
} from "../middleware/bodyLimit";
import { hasAgreedToTerms, requireConsent } from "../middleware/consent";

function storageFailure(c: Context<AppEnv>, error: unknown) {
  if (isStorageLimitError(error)) {
    return c.json({ error: API_ERRORS.deck.tooLarge }, 413);
  }
  if (isTransientStorageError(error)) {
    return c.json({ error: API_ERRORS.deck.saveFailed }, 503);
  }
  return c.json({ error: API_ERRORS.deck.saveFailed }, 500);
}

/**
 * 곡 보관함(scope: 'library') 동기화 API.
 *
 * 프레젠테이션에 속한 덱은 프레젠테이션 문서에 임베드되어 함께 저장되므로
 * 여기서는 다루지 않는다 (`/api/presentations`).
 *
 * 쓰기 한도(`DeckWriteSchema`)나 Firestore 저장 한도를 넘는 곡은 400·500 대신 413과 가사를
 * 나누라는 문장으로 답한다.
 */
export function createDecksRoute(deps: AppDeps = {}) {
  const savedId = idParam(API_ERRORS.idMismatch, 400);
  const deckId = idParam(API_ERRORS.deck.notAccessible, 404);
  const publicDeckId = idParam(API_ERRORS.deck.notPublished, 404);
  const deckBody = jsonBody(
    DeckWriteSchema,
    DECK_BODY_MAX_BYTES,
    rejectOverLimit(() => API_ERRORS.deck.tooLarge),
  );

  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .get("/", async (c) => {
      const db = c.env.DB;
      const rows = await getMyLibraryDecks(db, c.get("userId") as string);
      return c.json({ decks: rows.map(toSharedDeck) }, 200);
    })
    .put("/:id", savedId, deckBody, async (c) => {
      const userId = c.get("userId") as string;
      const deck = c.req.valid("json");

      if (deck.id !== c.req.param("id")) {
        return c.json({ error: API_ERRORS.idMismatch }, 400);
      }
      if (deck.scope !== "library") {
        return c.json({ error: API_ERRORS.deck.libraryOnly }, 400);
      }

      const db = c.env.DB;

      let saved;
      try {
        saved = await upsertDeck(db, userId, deck);
        if (!saved) {
          return c.json({ error: API_ERRORS.deck.notAccessible }, 403);
        }
      } catch (error) {
        logServerError(c, "deck upsert failed", error, { deckId: deck.id });
        return storageFailure(c, error);
      }

      return c.json({ ok: true as const, deck: saved }, 200);
    })
    .patch(
      "/:id/visibility",
      deckId,
      jsonBody(VisibilityUpdateRequestSchema, SMALL_BODY_MAX_BYTES),
      async (c) => {
        const db = c.env.DB;
        const { visibility } = c.req.valid("json");
        if (visibility === "public" && !(await hasAgreedToTerms(c))) {
          return c.json({ error: API_ERRORS.consentRequired }, 403);
        }
        let result: SetVisibilityResult;
        try {
          result = await setDeckVisibility(
            db,
            c.get("userId") as string,
            c.req.param("id"),
            visibility,
          );
        } catch (error) {
          logServerError(c, "deck visibility update failed", error, {
            deckId: c.req.param("id"),
            visibility,
          });
          return storageFailure(c, error);
        }

        switch (result.status) {
          case "ok":
            return c.json({ deck: result.deck }, 200);
          case "not_found":
            return c.json({ error: API_ERRORS.deck.notAccessible }, 404);
          case "not_library":
            return c.json({ error: API_ERRORS.deck.publishFromLibrary }, 400);
          case "empty":
            return c.json({ error: API_ERRORS.deck.noSlides }, 400);
          case "taken_down":
            return c.json(
              {
                error: API_ERRORS.deck.takenDown,
              },
              409,
            );
        }
      },
    )
    .post("/:id/fork", publicDeckId, requireConsent, async (c) => {
      const db = c.env.DB;
      const result = await forkPublicDeck(
        db,
        c.get("userId") as string,
        c.req.param("id"),
      );
      if (result.status === "not_found") {
        return c.json({ error: API_ERRORS.deck.notPublished }, 404);
      }
      return c.json(
        { deck: result.deck, alreadyOwned: result.alreadyOwned },
        200,
      );
    })
    .delete("/:id", deckId, async (c) => {
      const db = c.env.DB;
      const removed = await deleteDeckScoped(
        db,
        c.req.param("id"),
        c.get("userId") as string,
      );

      if (!removed) {
        return c.json({ error: API_ERRORS.deck.notAccessible }, 404);
      }
      return c.json({ ok: true as const }, 200);
    });
}
