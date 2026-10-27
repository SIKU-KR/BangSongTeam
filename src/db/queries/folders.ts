import {
  buildFolderIndex,
  collectDescendantFolderIds,
  isFolderTrashed,
  sortFoldersParentFirst,
  wouldCreateCycle,
  type DriveTombstones,
  type Folder as SharedFolder,
  type FolderDeleteRequest,
} from "#shared";
import type { Db } from "../client";
import {
  driveTombstonesCol,
  foldersCol,
  presentationsCol,
  type FolderDoc,
  type PresentationDoc,
} from "../collections";
import { toFolderDoc, toSharedFolder } from "./mappers";
import {
  prepareClearTombstone,
  prepareDeletionPass,
  runDeletionPasses,
  type DeletionResult,
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
 * - 본문의 `userId`가 세션 사용자가 아니어도 `null` (→ 403). 아직 A라고 믿는 탭이나 A가 남긴
 *   대기열이 보낸 폴더를 지금 쿠키의 주인인 B의 드라이브에 만들면 안 된다.
 * - 새 폴더의 id가 이미 프레젠테이션 id여도 `null` (→ 403). 영구 삭제 기록은 폴더와
 *   프레젠테이션이 한 id 공간을 쓰고, 프레젠테이션 id는 링크로 공유받은 사람에게도 보인다. 그 id로
 *   폴더를 만들어 지우면 주인보다 먼저 기록을 차지해, 주인이 영구 삭제한 프레젠테이션을 주인의
 *   다른 기기가 다시 올린다.
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
  if (folder.userId !== userId) return null;
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
    if (
      !existing &&
      (await tx.get(presentationsCol(db).doc(folder.id))).exists
    ) {
      return null;
    }

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

export type DeleteFolderTreeResult = DeletionResult;

type ExpectedFolderTree = NonNullable<FolderDeleteRequest["expected"]>;

function holdsUnseenItems(
  expected: ExpectedFolderTree,
  folderIds: readonly string[],
  presentationIds: readonly string[],
): boolean {
  const seenFolders = new Set(expected.folderIds);
  const seenPresentations = new Set(expected.presentationIds);
  return (
    folderIds.some((id) => !seenFolders.has(id)) ||
    presentationIds.some((id) => !seenPresentations.has(id))
  );
}

/**
 * 폴더를 하위 폴더·프레젠테이션과 함께 영구 삭제한다 (휴지통 비우기).
 *
 * 서버에서 그 폴더나 조상이 휴지통에 있을 때만 지운다. 요청은 다른 기기에서 복원한 것을 모르는
 * 오래된 탭에서 올 수 있다. `expected`(그 기기가 본 하위 트리)가 오면 서버 트리가 그 안에 들 때만
 * 지운다. 그 기기에 아직 안 보인 프레젠테이션·하위 폴더를 함께 지우지 않기 위해서다. 목록에 서버에 없는
 * id가 더 있는 것은 괜찮다. 확인은 모두 쓰기 전에 해서, 거절할 때는 아무것도 쓰지 않는다.
 *
 * 프레젠테이션은 담긴 사본 곡·공유 멤버와 함께 지우고, 지운 폴더·프레젠테이션마다 영구
 * 삭제 기록을 남긴다. 큰 트리는 트랜잭션 여러 개로 나눠 지운다(`runDeletionPasses`). 차례마다 위
 * 확인을 다시 하고, 깊은 폴더부터 지우고 이 폴더를 마지막에 지운다. 중간에 멈춰도 남은 것은 모두
 * 이 폴더 아래 휴지통에 있어 다시 지우면 이어서 끝난다.
 */
export async function deleteFolderTree(
  db: Db,
  userId: string,
  folderId: string,
  expected?: ExpectedFolderTree,
): Promise<DeleteFolderTreeResult> {
  return runDeletionPasses(db, async (tx) => {
    const ownFolders = await tx.get(
      foldersCol(db).where("userId", "==", userId),
    );
    const folders = ownFolders.docs.map((doc) => toSharedFolder(doc.data()));
    const index = buildFolderIndex(folders);
    if (!index.byId.has(folderId)) return "notFound";
    if (!isFolderTrashed(index, folderId)) return "conflict";

    const subtree = collectDescendantFolderIds(index, folderId);
    const ownPresentations = await tx.get(
      presentationsCol(db).where("userId", "==", userId),
    );
    const presentationIds = ownPresentations.docs
      .filter((doc) => subtree.has(doc.data().folderId ?? ""))
      .map((doc) => doc.id);
    if (expected && holdsUnseenItems(expected, [...subtree], presentationIds)) {
      return "conflict";
    }

    const childFirst = sortFoldersParentFirst(
      folders.filter((folder) => subtree.has(folder.id)),
      folders,
    )
      .reverse()
      .map((folder) => folder.id);
    return prepareDeletionPass(tx, db, userId, presentationIds, childFirst);
  });
}

/**
 * 프레젠테이션이 휴지통에 있는지: 자신이 휴지통에 있거나, 담긴 폴더나 그 조상이 휴지통에 있다.
 *
 * 클라이언트의 `isPresentationTrashed`와 같은 규칙이다. 폴더 목록 전체 대신 담긴 폴더부터 부모를
 * 하나씩 읽는다(보통 1~3번). 없거나 남의 폴더에 닿으면 그 앞이 루트이고, 지난 폴더로 돌아오면
 * `buildFolderIndex`처럼 그 폴더에서 사이클을 끊어 그 너머는 보지 않는다. 휴지통 필드가 없는 옛
 * 문서는 휴지통 밖이다. 그래서 판단이 어긋나면 영구 삭제를 거절하는 쪽으로만 어긋난다.
 */
export async function isPresentationInTrash(
  readFolder: (id: string) => Promise<FolderDoc | undefined>,
  presentation: Pick<PresentationDoc, "userId" | "folderId" | "trashedAt">,
): Promise<boolean> {
  if (presentation.trashedAt) return true;

  const chain: FolderDoc[] = [];
  const positionOf = new Map<string, number>();
  let cursor = presentation.folderId;
  while (cursor) {
    const position = positionOf.get(cursor);
    if (position !== undefined) {
      chain.length = position + 1;
      break;
    }
    const folder = await readFolder(cursor);
    if (folder?.userId !== presentation.userId) break;
    positionOf.set(cursor, chain.length);
    chain.push(folder);
    cursor = folder.parentId;
  }
  return chain.some((folder) => Boolean(folder.trashedAt));
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
