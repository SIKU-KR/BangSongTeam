import {
  buildFolderIndex,
  collectDescendantFolderIds,
  wouldCreateCycle,
  type DriveTombstones,
  type Folder as SharedFolder,
} from "#shared";
import type { Db } from "../client";
import {
  driveTombstonesCol,
  foldersCol,
  presentationsCol,
  type FolderDoc,
} from "../collections";
import { toFolderDoc, toSharedFolder } from "./mappers";
import {
  prepareClearTombstone,
  readPresentationDependents,
  writeTombstones,
} from "./cascade";

function byCreatedAtAsc(a: FolderDoc, b: FolderDoc): number {
  return (
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** 본인 폴더 전체 (생성 순) */
export async function getFoldersByUserId(
  db: Db,
  userId: string,
): Promise<SharedFolder[]> {
  const snapshot = await foldersCol(db).where("userId", "==", userId).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .sort(byCreatedAtAsc)
    .map(toSharedFolder);
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
  db: Db,
  userId: string,
  folder: SharedFolder,
): Promise<SharedFolder | null> {
  return db.runTransaction(async (tx) => {
    const ref = foldersCol(db).doc(folder.id);
    const [existingSnapshot, ownFolders, clearTombstone] = await Promise.all([
      tx.get(ref),
      folder.parentId === null
        ? Promise.resolve(null)
        : tx.get(foldersCol(db).where("userId", "==", userId)),
      prepareClearTombstone(tx, db, userId, folder.id),
    ]);
    const existing = existingSnapshot.data();
    if (existing && existing.userId !== userId) return null;

    let parentId = folder.parentId;
    if (parentId !== null && ownFolders) {
      const index = buildFolderIndex(
        ownFolders.docs.map((doc) => toSharedFolder(doc.data())),
      );
      if (
        !index.byId.has(parentId) ||
        wouldCreateCycle(index, folder.id, parentId)
      ) {
        parentId = null;
      }
    }

    const saved: SharedFolder = { ...folder, userId, parentId };
    const next = toFolderDoc(saved);

    clearTombstone();
    tx.set(
      ref,
      existing
        ? {
            ...existing,
            parentId: next.parentId,
            name: next.name,
            trashedAt: next.trashedAt,
            updatedAt: next.updatedAt,
          }
        : next,
    );
    return saved;
  });
}

export interface DeletedFolderTree {
  folderIds: string[];
  presentationIds: string[];
}

/**
 * 폴더를 하위 폴더·프레젠테이션과 함께 영구 삭제한다 (휴지통 비우기).
 *
 * 프레젠테이션은 담긴 사본 곡·공유 멤버와 함께 지우고, 지운 폴더·프레젠테이션마다 영구
 * 삭제 기록을 남긴다. 모두 한 트랜잭션이라 중간에 실패해도 반쪽 트리가 남지 않는다.
 *
 * 없거나 남의 폴더면 `null` (→ 404).
 */
export async function deleteFolderTree(
  db: Db,
  userId: string,
  folderId: string,
): Promise<DeletedFolderTree | null> {
  return db.runTransaction(async (tx) => {
    const ownFolders = await tx.get(
      foldersCol(db).where("userId", "==", userId),
    );
    const index = buildFolderIndex(
      ownFolders.docs.map((doc) => toSharedFolder(doc.data())),
    );
    if (!index.byId.has(folderId)) return null;

    const folderIds = [...collectDescendantFolderIds(index, folderId)];
    const inTree = new Set(folderIds);
    const ownPresentations = await tx.get(
      presentationsCol(db).where("userId", "==", userId),
    );
    const presentationIds = ownPresentations.docs
      .filter((doc) => inTree.has(doc.data().folderId ?? ""))
      .map((doc) => doc.id);
    const dependents = await readPresentationDependents(
      tx,
      db,
      presentationIds,
    );

    for (const ref of dependents) tx.delete(ref);
    for (const id of presentationIds) tx.delete(presentationsCol(db).doc(id));
    for (const id of folderIds) tx.delete(foldersCol(db).doc(id));
    writeTombstones(tx, db, userId, "folder", folderIds);
    writeTombstones(tx, db, userId, "presentation", presentationIds);
    return { folderIds, presentationIds };
  });
}

/** 본인이 영구 삭제한 폴더·프레젠테이션 id (다른 기기의 부팅 병합용) */
export async function getDriveTombstones(
  db: Db,
  userId: string,
): Promise<DriveTombstones> {
  const snapshot = await driveTombstonesCol(db)
    .where("userId", "==", userId)
    .get();
  const rows = snapshot.docs.map((doc) => doc.data());
  return {
    folderIds: rows.filter((r) => r.kind === "folder").map((r) => r.itemId),
    presentationIds: rows
      .filter((r) => r.kind === "presentation")
      .map((r) => r.itemId),
  };
}
