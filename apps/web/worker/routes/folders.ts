import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { FolderSchema } from "@repo/shared";
import {
  createD1Client,
  getFoldersByUserId,
  getDriveTombstones,
  upsertFolder,
  deleteFolderTree,
} from "@repo/db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

/**
 * 드라이브 폴더 동기화 API (홈 `/presentations`의 폴더 트리).
 *
 * 폴더는 1건 단위로 주고받는다. 휴지통은 `trashedAt`을 담은 PUT이고, DELETE는
 * 휴지통 비우기·영구 삭제 전용이다 (하위 폴더·프레젠테이션까지 지운다).
 * `userId`는 언제나 세션에서 가져온다 (D1에 RLS 없음).
 */
export function createFoldersRoute(deps: AppDeps = {}) {
  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .get("/", async (c) => {
      const db = createD1Client(c.env.DB);
      const userId = c.get("userId") as string;
      const [folders, tombstones] = await Promise.all([
        getFoldersByUserId(db, userId),
        getDriveTombstones(db, userId),
      ]);
      return c.json({ folders, tombstones }, 200);
    })
    .put("/:id", zValidator("json", FolderSchema), async (c) => {
      const userId = c.get("userId") as string;
      const folder = c.req.valid("json");

      if (folder.id !== c.req.param("id")) {
        return c.json({ error: "폴더 id가 경로와 일치하지 않습니다" }, 400);
      }

      const db = createD1Client(c.env.DB);

      let saved;
      try {
        saved = await upsertFolder(db, userId, folder);
        if (!saved) {
          return c.json({ error: "이 폴더에 접근할 수 없습니다" }, 403);
        }
      } catch (error) {
        console.error("folder upsert failed", { folderId: folder.id, error });
        return c.json({ error: "폴더를 저장하지 못했습니다" }, 500);
      }

      // 부모 보정(루트로 이동)이 있었을 수 있으므로 확정본을 돌려준다.
      return c.json({ folder: saved }, 200);
    })
    .delete("/:id", async (c) => {
      const db = createD1Client(c.env.DB);
      const deleted = await deleteFolderTree(
        db,
        c.get("userId") as string,
        c.req.param("id"),
      );

      if (!deleted) {
        return c.json({ error: "이 폴더에 접근할 수 없습니다" }, 404);
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

export const foldersRoute = createFoldersRoute();
export default foldersRoute;
