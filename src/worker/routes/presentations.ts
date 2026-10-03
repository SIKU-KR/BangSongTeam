import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  API_ERRORS,
  toPresentationChanges,
  type PresentationChanges,
  PresentationChangesSchema,
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
  savePresentationChanges,
  setLinkAccess,
  type SavePresentationResult,
} from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { isTransientStorageError } from "../lib/storageErrors";

async function save(c: Context<AppEnv>, changes: PresentationChanges) {
  if (changes.id !== c.req.param("id")) {
    return c.json({ error: API_ERRORS.idMismatch }, 400);
  }

  let result: SavePresentationResult;
  try {
    result = await savePresentationChanges(
      createD1Client(c.env.DB),
      c.get("userId") as string,
      changes,
    );
  } catch (error) {
    console.error("presentation upsert failed", {
      presentationId: changes.id,
      songCount: changes.items.length,
      sentDeckCount: changes.decks.length,
      error,
    });
    if (isTransientStorageError(error)) {
      c.header("Retry-After", "2");
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
      if (!document)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
      return c.json({ presentation: document }, 200);
    })
    .put("/:id", zValidator("json", PresentationDocumentSchema), async (c) => {
      const document = c.req.valid("json");
      return save(c, toPresentationChanges(document));
    })
    .patch("/:id", zValidator("json", PresentationChangesSchema), async (c) =>
      save(c, c.req.valid("json")),
    )
    .delete("/:id", async (c) => {
      const removed = await deletePresentation(
        createD1Client(c.env.DB),
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!removed)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
      return c.json({ ok: true as const }, 200);
    })
    .get("/:id/share", async (c) => {
      const settings = await getShareSettings(
        createD1Client(c.env.DB),
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!settings)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
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
        if (!settings)
          return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
        return c.json(settings, 200);
      },
    )
    .post("/:id/share/reset", async (c) => {
      const settings = await resetLinkToken(
        createD1Client(c.env.DB),
        c.req.param("id"),
        c.get("userId") as string,
      );
      if (!settings)
        return c.json({ error: API_ERRORS.presentation.notAccessible }, 404);
      return c.json(settings, 200);
    });
}
