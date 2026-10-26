import { Hono, type Context } from "hono";
import {
  API_ERRORS,
  isReservedDocumentId,
  toPresentationChanges,
  type Deck,
  type PresentationChanges,
  PresentationChangesSchema,
  PresentationDocumentSchema,
  UpdateShareSettingsRequestSchema,
} from "#shared";
import {
  deletePresentation,
  getPresentationDocument,
  getPresentationDocumentsByUserId,
  getShareSettings,
  getSharedPresentationDocuments,
  resetLinkToken,
  savePresentationChanges,
  setLinkAccess,
  type SavePresentationResult,
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
import {
  PRESENTATION_BODY_MAX_BYTES,
  SMALL_BODY_MAX_BYTES,
} from "../middleware/bodyLimit";
import { hasAgreedToTerms } from "../middleware/consent";

function songTextLength(deck: Deck): number {
  return (
    deck.lyricsRaw.length +
    deck.slides.reduce(
      (sum, slide) =>
        sum + slide.lines.reduce((lines, line) => lines + line.length, 0),
      0,
    )
  );
}

function largestSongTitle(decks: readonly Deck[]): string | null {
  let largest: Deck | null = null;
  for (const deck of decks) {
    if (!largest || songTextLength(deck) > songTextLength(largest)) {
      largest = deck;
    }
  }
  return largest?.title ?? null;
}

async function save(c: Context<AppEnv>, changes: PresentationChanges) {
  if (
    changes.id !== c.req.param("id") ||
    changes.decks.some((deck) => isReservedDocumentId(deck.id))
  ) {
    return c.json({ error: API_ERRORS.idMismatch }, 400);
  }

  let result: SavePresentationResult;
  try {
    result = await savePresentationChanges(
      c.env.DB,
      c.get("userId") as string,
      changes,
    );
  } catch (error) {
    logServerError(c, "presentation upsert failed", error, {
      presentationId: changes.id,
      songCount: changes.items.length,
      sentDeckCount: changes.decks.length,
    });
    if (isStorageLimitError(error)) {
      const title = largestSongTitle(changes.decks);
      return c.json(
        {
          error: title
            ? API_ERRORS.presentation.songTooLarge(title)
            : API_ERRORS.presentation.saveFailed,
        },
        413,
      );
    }
    if (isTransientStorageError(error)) {
      return c.json({ error: API_ERRORS.presentation.saveFailed }, 503);
    }
    return c.json({ error: API_ERRORS.presentation.saveFailed }, 500);
  }

  if (result === "forbidden")
    return c.json({ error: API_ERRORS.presentation.notAccessible }, 403);
  if (result === "stale") {
    return c.json({ error: API_ERRORS.presentation.fullSyncRequired }, 409);
  }
  return c.json({ ok: true as const }, 200);
}

/**
 * 프레젠테이션 문서 동기화 API.
 *
 * 조회는 로컬 IndexedDB가 문서 1건을 통째로 put하는 것과 같은 단위로 주고받는다.
 * 저장은 문서 전체(`PUT`, 이전 버전 클라이언트와 부팅 동기화)나 바뀐 덱만 담은
 * 변경분(`PATCH`)으로 받으며, 결과는 둘 다 문서 단위 전체 교체와 같다.
 * `userId`는 세션에서 가져오고, 본문의 userId가 세션 사용자와 다르면 403으로 거절한다 (다른
 * 계정으로 바뀐 탭·남은 대기열이 보낸 문서를 지금 쿠키의 계정에 만들지 않는다. Firestore에
 * 사용자별 접근 규칙이 없다).
 * 목록·단건 조회에는 링크로 공유받은 세트(`access`가 붙음, 보기 전용)도 온다.
 * 저장은 소유자만 할 수 있다.
 */
export function createPresentationsRoute(deps: AppDeps = {}) {
  const savedId = idParam(API_ERRORS.idMismatch, 400);
  const presentationId = idParam(API_ERRORS.presentation.notAccessible, 404);
  const documentBody = jsonBody(
    PresentationDocumentSchema,
    PRESENTATION_BODY_MAX_BYTES,
  );
  const changesBody = jsonBody(
    PresentationChangesSchema,
    PRESENTATION_BODY_MAX_BYTES,
  );

  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .get("/", async (c) => {
      const db = c.env.DB;
      const userId = c.get("userId") as string;
      const [own, shared] = await Promise.all([
        getPresentationDocumentsByUserId(db, userId),
        getSharedPresentationDocuments(db, userId),
      ]);
      return c.json({ presentations: [...own, ...shared] }, 200);
    })
    .get("/:id", presentationId, async (c) => {
      const db = c.env.DB;
      const document = await getPresentationDocument(
        db,
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!document)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
      return c.json({ presentation: document }, 200);
    })
    .put("/:id", savedId, documentBody, async (c) => {
      const document = c.req.valid("json");
      return save(c, toPresentationChanges(document));
    })
    .patch("/:id", savedId, changesBody, async (c) =>
      save(c, c.req.valid("json")),
    )
    .delete("/:id", presentationId, async (c) => {
      const removed = await deletePresentation(
        c.env.DB,
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!removed)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
      return c.json({ ok: true as const }, 200);
    })
    .get("/:id/share", presentationId, async (c) => {
      const settings = await getShareSettings(
        c.env.DB,
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!settings)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
      return c.json(settings, 200);
    })
    .put(
      "/:id/share",
      presentationId,
      jsonBody(UpdateShareSettingsRequestSchema, SMALL_BODY_MAX_BYTES),
      async (c) => {
        const { access } = c.req.valid("json");
        if (access !== "off" && !(await hasAgreedToTerms(c))) {
          return c.json({ error: API_ERRORS.consentRequired }, 403);
        }
        const settings = await setLinkAccess(
          c.env.DB,
          c.req.param("id"),
          c.get("userId") as string,
          access,
        );
        if (!settings)
          return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
        return c.json(settings, 200);
      },
    )
    .post("/:id/share/reset", presentationId, async (c) => {
      const settings = await resetLinkToken(
        c.env.DB,
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!settings)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
      return c.json(settings, 200);
    });
}
