import { Hono } from "hono";
import { API_ERRORS, FolderSchema } from "#shared";
import {
  getFoldersByUserId,
  getDriveTombstones,
  upsertFolder,
  deleteFolderTree,
} from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { isTransientStorageError } from "../lib/storageErrors";
import { logServerError } from "../lib/requestLog";
import { idParam } from "../lib/params";
import { jsonBody } from "../lib/jsonBody";
import { SMALL_BODY_MAX_BYTES } from "../middleware/bodyLimit";

/**
 * 드라이브 폴더 동기화 API (홈 `/presentations`의 폴더 트리).
 *
 * 폴더는 1건 단위로 주고받는다. 휴지통은 `trashedAt`을 담은 PUT이고, DELETE는
 * 휴지통 비우기·영구 삭제 전용이다 (하위 폴더·프레젠테이션까지 지운다).
 * `userId`는 세션에서 가져오고, 본문의 userId가 세션 사용자와 다르면 403으로 거절한다 (다른
 * 계정으로 바뀐 탭·남은 대기열이 보낸 문서를 지금 쿠키의 계정에 만들지 않는다. Firestore에
 * 사용자별 접근 규칙이 없다).
 */
export function createFoldersRoute(deps: AppDeps = {}) {
  const savedId = idParam(API_ERRORS.idMismatch, 400);
  const folderId = idParam(API_ERRORS.folder.notAccessible, 404);
  const folderBody = jsonBody(FolderSchema, SMALL_BODY_MAX_BYTES);

  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .get("/", async (c) => {
      const db = c.env.DB;
      const userId = c.get("userId") as string;
      const [folders, tombstones] = await Promise.all([
        getFoldersByUserId(db, userId),
        getDriveTombstones(db, userId),
      ]);
      return c.json({ folders, tombstones }, 200);
    })
    .put("/:id", savedId, folderBody, async (c) => {
      const userId = c.get("userId") as string;
      const folder = c.req.valid("json");

      if (folder.id !== c.req.param("id")) {
        return c.json({ error: API_ERRORS.idMismatch }, 400);
      }

      const db = c.env.DB;

      let saved;
      try {
        saved = await upsertFolder(db, userId, folder);
        if (!saved) {
          return c.json({ error: API_ERRORS.folder.notAccessible }, 403);
        }
      } catch (error) {
        logServerError(c, "folder upsert failed", error, {
          folderId: folder.id,
        });
        if (isTransientStorageError(error)) {
          return c.json({ error: API_ERRORS.folder.saveFailed }, 503);
        }
        return c.json({ error: API_ERRORS.folder.saveFailed }, 500);
      }

      return c.json({ folder: saved }, 200);
    })
    .delete("/:id", folderId, async (c) => {
      const db = c.env.DB;
      const deleted = await deleteFolderTree(
        db,
        c.get("userId") as string,
        c.req.param("id"),
      );

      if (!deleted) {
        return c.json({ error: API_ERRORS.folder.notAccessible }, 404);
      }
      return c.json(
        {
          ok: true as const,
          deletedFolderIds: deleted.folderIds,
          deletedPresentationIds: deleted.presentationIds,
        },
        200,
      );
    });
}
