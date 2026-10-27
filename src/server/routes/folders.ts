import { Hono } from "hono";
import { API_ERRORS, FolderDeleteRequestSchema, FolderSchema } from "#shared";
import {
  getFoldersByUserId,
  getDriveTombstones,
  upsertFolder,
  deleteFolderTree,
  type UpsertFolderResult,
} from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { isTransientStorageError } from "../lib/storageErrors";
import { logRequestEvent, logServerError } from "../lib/requestLog";
import { idParam } from "../lib/params";
import { jsonBody } from "../lib/jsonBody";
import {
  FOLDER_DELETE_BODY_MAX_BYTES,
  SMALL_BODY_MAX_BYTES,
} from "../middleware/bodyLimit";

/**
 * 드라이브 폴더 동기화 API (홈 `/presentations`의 폴더 트리).
 *
 * 폴더는 1건 단위로 주고받는다. 휴지통은 `trashedAt`을 담은 PUT이고, DELETE는
 * 휴지통 비우기·영구 삭제 전용이다 (하위 폴더·프레젠테이션까지 지운다).
 * PUT은 서버에 저장된 확정본을 돌려준다. 저장된 폴더가 더 나중에 고친 것이면 쓰지 않고 그 폴더로
 * 200이다. 영구 삭제한 폴더에 늦게 온 PUT은 다시 만들지 않고 410이다. 폴더가 이미
 * `MAX_FOLDERS_PER_USER`개인 사용자의 새 폴더 PUT은 만들지 않고 403이다(이미 있는 폴더의 PUT은 그대로
 * 받는다). 410과 상한 403은 얼마나 자주 일어나는지 보려고 INFO 로그로 남긴다(상한 403은 접근 거절 403과
 * 요청 로그 줄만으로는 구별되지 않는다).
 * DELETE는 서버에서 그 폴더나 조상이 휴지통에 있을 때만 지운다. 본문의 `expected`(그 기기가 본
 * 하위 트리)를 받으면 서버 트리가 그 안에 들 때만 지운다. 어느 쪽이든 어긋나면 아무것도 지우지
 * 않고 409로 답한다. 본문이 없는 이전 클라이언트는 휴지통 확인만 받는다. 큰 트리를 나눠 지우는
 * 중에 어긋나면 그때까지 지운 것은 지운 채 409(`trashChangedPartly`)로 답한다.
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

      let result: UpsertFolderResult;
      try {
        result = await upsertFolder(db, userId, folder);
      } catch (error) {
        logServerError(c, "folder upsert failed", error, {
          folderId: folder.id,
        });
        if (isTransientStorageError(error)) {
          return c.json({ error: API_ERRORS.folder.saveFailed }, 503);
        }
        return c.json({ error: API_ERRORS.folder.saveFailed }, 500);
      }

      switch (result.status) {
        case "forbidden":
          return c.json({ error: API_ERRORS.folder.notAccessible }, 403);
        case "deleted":
          logRequestEvent(c, "INFO", "folder_save_deleted", {
            folderId: folder.id,
          });
          return c.json({ error: API_ERRORS.folder.deleted }, 410);
        case "limitReached":
          logRequestEvent(c, "INFO", "folder_save_limit_reached", {
            folderId: folder.id,
          });
          return c.json({ error: API_ERRORS.folder.limitReached }, 403);
        case "saved":
          return c.json({ folder: result.folder }, 200);
      }
    })
    .delete(
      "/:id",
      folderId,
      jsonBody(
        FolderDeleteRequestSchema.optional(),
        FOLDER_DELETE_BODY_MAX_BYTES,
      ),
      async (c) => {
        const result = await deleteFolderTree(
          c.env.DB,
          c.get("userId") as string,
          c.req.param("id"),
          c.req.valid("json")?.expected,
        );

        if (result.status === "notFound") {
          return c.json({ error: API_ERRORS.folder.notAccessible }, 404);
        }
        if (result.status === "conflict") {
          return c.json(
            {
              error: result.partial
                ? API_ERRORS.trashChangedPartly
                : API_ERRORS.trashChanged,
            },
            409,
          );
        }
        return c.json(
          {
            ok: true as const,
            deletedFolderIds: result.folderIds,
            deletedPresentationIds: result.presentationIds,
          },
          200,
        );
      },
    );
}
