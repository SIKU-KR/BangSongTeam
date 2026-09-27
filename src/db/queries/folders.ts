import { and, asc, eq, inArray } from "drizzle-orm";
import {
  buildFolderIndex,
  collectDescendantFolderIds,
  wouldCreateCycle,
  type DriveTombstones,
  type Folder as SharedFolder,
} from "#shared";
import {
  folders,
  presentations,
  presentationItems,
  decks,
  driveTombstones,
} from "../schema";
import { toFolderRow, toSharedFolder } from "./mappers";
import { chunkIds, runStatements } from "./batch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/** 본인 폴더 전체 (생성 순) */
export async function getFoldersByUserId(
  db: DbInstance,
  userId: string,
): Promise<SharedFolder[]> {
  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(asc(folders.createdAt));
  return rows.map(toSharedFolder);
}

/**
 * 폴더 id가 이 사용자 것이면 그대로, 아니면(남의 것·없음) `null`(루트).
 * 프레젠테이션 업서트가 `folder_id` 외래키를 어기지 않게 한다.
 */
export async function resolveOwnedFolderId(
  db: DbInstance,
  userId: string,
  folderId: string | null,
): Promise<string | null> {
  if (folderId === null) return null;
  const [owned] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
  return owned ? folderId : null;
}

/**
 * 폴더 1건 업서트.
 *
 * - 남의 폴더면 아무것도 쓰지 않고 `null` (→ 403).
 * - 부모가 없거나, 남의 것이거나, 옮기면 사이클이 생기면 **루트로 보정**한다.
 *   오프라인 기기 두 대가 서로 반대로 옮기거나 다른 기기에서 부모를 영구
 *   삭제하면 생기는 일이다. 거절하면 그 폴더는 영영 동기화되지 않으므로,
 *   받아들이되 트리가 깨지지 않는 쪽으로 고친다.
 *
 * 보정된 확정본을 돌려준다. 클라이언트는 이것을 반영한다.
 */
export async function upsertFolder(
  db: DbInstance,
  userId: string,
  folder: SharedFolder,
): Promise<SharedFolder | null> {
  const [existing] = await db
    .select({ userId: folders.userId })
    .from(folders)
    .where(eq(folders.id, folder.id));

  if (existing && existing.userId !== userId) return null;

  let parentId = folder.parentId;
  if (parentId !== null) {
    const index = buildFolderIndex(await getFoldersByUserId(db, userId));
    if (
      !index.byId.has(parentId) ||
      wouldCreateCycle(index, folder.id, parentId)
    ) {
      parentId = null;
    }
  }

  const saved: SharedFolder = { ...folder, userId, parentId };
  const row = toFolderRow(saved);

  await clearTombstone(db, userId, folder.id);

  if (existing) {
    await db
      .update(folders)
      .set({
        parentId: row.parentId,
        name: row.name,
        trashedAt: row.trashedAt,
        updatedAt: row.updatedAt,
      })
      .where(and(eq(folders.id, folder.id), eq(folders.userId, userId)));
  } else {
    await db.insert(folders).values(row);
  }

  return saved;
}

export interface DeletedFolderTree {
  folderIds: string[];
  presentationIds: string[];
}

/**
 * 폴더를 하위 폴더·프레젠테이션과 함께 영구 삭제한다 (휴지통 비우기).
 *
 * 외래키 cascade에 기대지 않고 명시적으로 지운다. `presentations.folder_id`는
 * 안전망으로 SET NULL이라 cascade로는 파일이 루트로 떨어질 뿐 지워지지 않고,
 * 테스트용 better-sqlite3는 외래키를 강제하지도 않는다.
 *
 * 없거나 남의 폴더면 `null` (→ 404).
 */
export async function deleteFolderTree(
  db: DbInstance,
  userId: string,
  folderId: string,
): Promise<DeletedFolderTree | null> {
  const index = buildFolderIndex(await getFoldersByUserId(db, userId));
  if (!index.byId.has(folderId)) return null;

  const folderIds = [...collectDescendantFolderIds(index, folderId)];

  const presentationIds: string[] = [];
  for (const chunk of chunkIds(folderIds)) {
    const rows = await db
      .select({ id: presentations.id })
      .from(presentations)
      .where(
        and(
          eq(presentations.userId, userId),
          inArray(presentations.folderId, chunk),
        ),
      );
    for (const row of rows as Array<{ id: string }>) {
      presentationIds.push(row.id);
    }
  }

  const statements: unknown[] = [];
  for (const chunk of chunkIds(presentationIds)) {
    statements.push(
      db
        .delete(presentationItems)
        .where(inArray(presentationItems.presentationId, chunk)),
      db.delete(decks).where(inArray(decks.presentationId, chunk)),
      db
        .delete(presentations)
        .where(
          and(
            eq(presentations.userId, userId),
            inArray(presentations.id, chunk),
          ),
        ),
    );
  }
  for (const chunk of chunkIds(folderIds)) {
    statements.push(
      db
        .delete(folders)
        .where(and(eq(folders.userId, userId), inArray(folders.id, chunk))),
    );
  }
  statements.push(
    ...tombstoneStatements(db, userId, "folder", folderIds),
    ...tombstoneStatements(db, userId, "presentation", presentationIds),
  );

  await runStatements(db, statements);
  return { folderIds, presentationIds };
}

/** 본인이 영구 삭제한 폴더·프레젠테이션 id (다른 기기의 부팅 병합용) */
export async function getDriveTombstones(
  db: DbInstance,
  userId: string,
): Promise<DriveTombstones> {
  const rows = (await db
    .select({ itemId: driveTombstones.itemId, kind: driveTombstones.kind })
    .from(driveTombstones)
    .where(eq(driveTombstones.userId, userId))) as Array<{
    itemId: string;
    kind: "folder" | "presentation";
  }>;

  return {
    folderIds: rows.filter((r) => r.kind === "folder").map((r) => r.itemId),
    presentationIds: rows
      .filter((r) => r.kind === "presentation")
      .map((r) => r.itemId),
  };
}

const TOMBSTONES_PER_STATEMENT = 20;

/** 영구 삭제 기록을 남기는 문장들 (호출자가 batch에 넣는다) */
export function tombstoneStatements(
  db: DbInstance,
  userId: string,
  kind: "folder" | "presentation",
  ids: readonly string[],
): unknown[] {
  const deletedAt = new Date();
  const statements: unknown[] = [];
  for (let i = 0; i < ids.length; i += TOMBSTONES_PER_STATEMENT) {
    const rows = ids
      .slice(i, i + TOMBSTONES_PER_STATEMENT)
      .map((itemId) => ({ itemId, userId, kind, deletedAt }));
    statements.push(
      db.insert(driveTombstones).values(rows).onConflictDoUpdate({
        target: driveTombstones.itemId,
        set: { kind, deletedAt },
      }),
    );
  }
  return statements;
}

/** 같은 id를 다시 저장하면 영구 삭제 기록을 지운다 (호출자가 batch에 넣는다) */
export function clearTombstoneStatement(
  db: DbInstance,
  userId: string,
  itemId: string,
): unknown {
  return db
    .delete(driveTombstones)
    .where(
      and(
        eq(driveTombstones.itemId, itemId),
        eq(driveTombstones.userId, userId),
      ),
    );
}

/** 같은 id를 다시 저장하면 영구 삭제 기록을 지운다 */
export async function clearTombstone(
  db: DbInstance,
  userId: string,
  itemId: string,
): Promise<void> {
  await clearTombstoneStatement(db, userId, itemId);
}
