import { useSyncExternalStore } from "react";
import {
  buildFolderIndex,
  createId,
  editTimestamp,
  folderNameKey,
  getFolderPath,
  isFarFuture,
  isFolderTrashed,
  MAX_FOLDER_NAME_LENGTH,
  resolveUniqueName,
  wouldCreateCycle,
  type Folder,
  type FolderIndex,
} from "#shared";
import {
  saveFolder,
  saveFolders,
  loadAllFolders,
  loadFolder,
  deleteFolders,
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
  createWriteRetry,
  type LoadedRecord,
  type WriteOp,
} from "../../lib/storage";
import { announceStorageChange } from "../../lib/storage/storageChannel";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import {
  scheduleFolderPush,
  cancelFolderPush,
} from "../../lib/sync/folderSync";
import { FOLDER_COPY } from "#copy/folders";

/**
 * 드라이브 폴더 스토어 (홈 `/presentations`의 폴더 트리).
 *
 * 프레젠테이션 스토어와 같은 오프라인 우선 규칙을 따른다. 바뀐 폴더는 곧바로
 * IndexedDB에 쓰고, 서버 push는 `folderSync` 큐가 디바운스를 두고 뒤따른다.
 *
 * 이름 규칙은 파일 탐색기와 같다. 같은 위치의 폴더끼리는 이름이 겹치지 않는다
 * (대소문자·앞뒤 공백 무시). 휴지통에 있는 폴더는 자리를 차지하지 않는다.
 *
 * 이름 바꾸기·이동·휴지통·복원은 수정 시각을 이 기기가 본 판보다 뒤로 찍는다
 * (`editTimestamp`). 서버는 저장된 폴더보다 이른 시각의 쓰기를 늦게 온 옛 수정으로 보고
 * 버리므로, 시계가 뒤처진 기기가 지금으로 찍으면 방금 고친 내용이 서버에 남지 않는다.
 */

export type FolderMutationResult =
  { ok: true; folder: Folder } | { ok: false; error: string };

let folders: Folder[] = [];
let index: FolderIndex<Folder> = buildFolderIndex(folders);
const listeners = new Set<() => void>();
let writes: Promise<void> = Promise.resolve();
const unpersisted = new Map<string, number>();
let hydrationFailed = false;

const writeRetry = createWriteRetry("folder", (failed) => {
  for (const [id, op] of failed) {
    queueWrite([id], index.byId.has(id) ? "save" : op, async () => {
      const latest = index.byId.get(id);
      if (latest) await saveFolder(latest);
      else if (op === "delete") await deleteFolders([id]);
    });
  }
});

function setFolders(next: Folder[]): void {
  folders = next;
  index = buildFolderIndex(next);
  for (const listener of listeners) listener();
}

function releaseUnpersisted(ids: readonly string[]): void {
  for (const id of ids) {
    const remaining = (unpersisted.get(id) ?? 1) - 1;
    if (remaining > 0) unpersisted.set(id, remaining);
    else unpersisted.delete(id);
  }
}

function queueWrite(
  ids: readonly string[],
  op: WriteOp,
  write: () => Promise<void>,
): void {
  for (const id of ids) unpersisted.set(id, (unpersisted.get(id) ?? 0) + 1);
  writes = writes
    .then(async () => {
      await write();
      announceStorageChange("folders", ids);
    })
    .then(
      () => {
        for (const id of ids) writeRetry.succeeded(id);
      },
      (err: unknown) => {
        for (const id of ids) writeRetry.failed(id, op, err);
      },
    )
    .finally(() => releaseUnpersisted(ids));
}

function commit(changed: Folder[]): void {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of changed) byId.set(folder.id, folder);
  setFolders([...byId.values()]);

  for (const folder of changed) {
    queueWrite([folder.id], "save", () => saveFolder(folder));
    scheduleFolderPush(folder);
  }
}

function now(): string {
  return new Date().toISOString();
}

export function getFolders(): Folder[] {
  return folders;
}

export function getFolderIndex(): FolderIndex<Folder> {
  return index;
}

export function getFolder(id: string | null | undefined): Folder | undefined {
  return id ? index.byId.get(id) : undefined;
}

/** 폴더가 있고, 자신이나 조상이 휴지통에 있지 않은지 */
export function isFolderAvailable(id: string | null | undefined): boolean {
  if (!id) return false;
  return index.byId.has(id) && !isFolderTrashed(index, id);
}

/**
 * 폴더 대신 보여 줄 가장 가까운 폴더. 쓸 수 있는 폴더는 그대로 돌려주고, 휴지통에 있는 폴더(조상이
 * 휴지통에 있는 경우 포함)는 열 수 있는 가장 가까운 조상을 돌려준다. 모르는 폴더거나 열 수 있는 조상이
 * 없으면 루트(`null`)다.
 *
 * 열려 있는 폴더를 휴지통에 넣으면 상위 폴더로 가는 이동이 끝나기 전에 옛 주소로 한 번 더 그려져, 그
 * 폴더를 열 수 없다고 보고 다른 곳으로 보낸다. 그곳이 루트면 곧이어 도착하는 상위 폴더 이동을 덮어쓴다.
 */
export function nearestAvailableFolder(
  id: string | null | undefined,
): string | null {
  const path = getFolderPath(index, id);
  const firstTrashed = path.findIndex((folder) => folder.trashedAt);
  const available = firstTrashed === -1 ? path : path.slice(0, firstTrashed);
  return available.at(-1)?.id ?? null;
}

function siblingNames(parentId: string | null, excludeId?: string): string[] {
  return (index.childrenOf.get(parentId) ?? [])
    .filter((folder) => folder.id !== excludeId && !folder.trashedAt)
    .map((folder) => folder.name);
}

/** 새 폴더 이름 입력의 첫 값. 같은 위치에 이미 있으면 번호를 붙여 바로 만들 수 있게 한다 */
export function suggestFolderName(parentId: string | null): string {
  return resolveUniqueName(FOLDER_COPY.newFolder, siblingNames(parentId));
}

function resolveTargetParent(parentId: string | null): string | null {
  return parentId !== null && isFolderAvailable(parentId) ? parentId : null;
}

/**
 * 새 폴더. 같은 위치에 같은 이름이 있으면 번호를 붙인다 ("새 폴더 (2)").
 * 부모가 없거나 휴지통에 있으면 루트에 만든다.
 */
export function createFolder(
  parentId: string | null,
  name: string = FOLDER_COPY.newFolder,
): Folder {
  const parent = resolveTargetParent(parentId);
  const timestamp = now();
  const folder: Folder = {
    id: createId(),
    userId: getCurrentUserId() ?? "",
    parentId: parent,
    name: resolveUniqueName(
      name.trim() || FOLDER_COPY.newFolder,
      siblingNames(parent),
    ),
    trashedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  commit([folder]);
  return folder;
}

/** 이름 입력값 검증. 문제가 있으면 사용자에게 보여 줄 문장을 돌려준다 */
export function validateFolderName(
  name: string,
  parentId: string | null,
  excludeId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return FOLDER_COPY.nameRequired;
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    return FOLDER_COPY.nameTooLong(MAX_FOLDER_NAME_LENGTH);
  }
  const key = folderNameKey(trimmed);
  if (siblingNames(parentId, excludeId).some((n) => folderNameKey(n) === key)) {
    return FOLDER_COPY.nameTaken;
  }
  return null;
}

/** 이름 바꾸기. 같은 위치에 같은 이름이 있으면 거절한다 (파일 탐색기와 같다) */
export function renameFolder(id: string, name: string): FolderMutationResult {
  const folder = index.byId.get(id);
  if (!folder) return { ok: false, error: FOLDER_COPY.folderNotFound };

  const parentId = index.parentOf.get(id) ?? null;
  const error = validateFolderName(name, parentId, id);
  if (error) return { ok: false, error };

  const trimmed = name.trim();
  if (trimmed === folder.name) return { ok: true, folder };

  const next = {
    ...folder,
    name: trimmed,
    updatedAt: editTimestamp(folder.updatedAt),
  };
  commit([next]);
  return { ok: true, folder: next };
}

/**
 * 폴더 이동. 자기 자신이나 하위 폴더로는 옮길 수 없다.
 * 옮겨 간 곳에 같은 이름이 있으면 번호를 붙인다.
 *
 * `preferredName`을 주면 지금 이름 대신 그 이름을 쓴다(겹치면 똑같이 번호를 붙인다). 이동을 되돌릴 때
 * 옮기며 붙은 번호를 걷어 내려는 것이다.
 */
export function moveFolder(
  id: string,
  parentId: string | null,
  preferredName?: string,
): FolderMutationResult {
  const folder = index.byId.get(id);
  if (!folder) return { ok: false, error: FOLDER_COPY.folderNotFound };
  if (parentId !== null && !isFolderAvailable(parentId)) {
    return { ok: false, error: FOLDER_COPY.targetFolderNotFound };
  }
  if (wouldCreateCycle(index, id, parentId)) {
    return { ok: false, error: FOLDER_COPY.cannotMoveIntoSelf };
  }
  if ((index.parentOf.get(id) ?? null) === parentId) {
    return { ok: true, folder };
  }

  const next: Folder = {
    ...folder,
    parentId,
    name: resolveUniqueName(
      preferredName ?? folder.name,
      siblingNames(parentId, id),
    ),
    updatedAt: editTimestamp(folder.updatedAt),
  };
  commit([next]);
  return { ok: true, folder: next };
}

/** 휴지통으로. 하위 항목은 조상 기준으로 함께 가려진다 (따로 표시하지 않는다) */
export function trashFolder(id: string): void {
  const folder = index.byId.get(id);
  if (!folder || folder.trashedAt) return;
  commit([
    {
      ...folder,
      trashedAt: now(),
      updatedAt: editTimestamp(folder.updatedAt),
    },
  ]);
}

/**
 * 휴지통에서 복원. 원래 위치가 없거나 휴지통에 있으면 루트로 돌아온다.
 * 돌아온 곳에 같은 이름이 있으면 번호를 붙인다.
 */
export function restoreFolder(id: string): void {
  const folder = index.byId.get(id);
  if (!folder || !folder.trashedAt) return;

  const originalParent = index.parentOf.get(id) ?? null;
  const parentId = resolveTargetParent(originalParent);
  commit([
    {
      ...folder,
      parentId,
      name: resolveUniqueName(folder.name, siblingNames(parentId, id)),
      trashedAt: null,
      updatedAt: editTimestamp(folder.updatedAt),
    },
  ]);
}

/**
 * 저장본으로 폴더를 복원한다. 세션 사용자의 폴더만 싣는다.
 *
 * 읽기 전에 앞서 실패한 쓰기의 다시 시도와 그 경고를 버린다. 읽지 못한 경고는 다시 불러올 때까지
 * 남긴다. 폴더를 저장했다고 지우면 읽지 못한 저장본이 있다는 것을 알 수 없다.
 */
export async function hydrateFoldersFromStorage(): Promise<void> {
  writeRetry.reset();
  const userId = getCurrentUserId();
  try {
    const { valid, corrupted } = await loadAllFolders();
    reportCorruptedRecords(corrupted);
    hydrationFailed = false;
    clearPersistenceError("folder:hydrate");
    setFolders(
      userId ? valid.filter((folder) => folder.userId === userId) : [],
    );
  } catch (err) {
    hydrationFailed = true;
    reportPersistenceError(err, "folder:hydrate");
    setFolders([]);
  }
}

function isSameFolder(a: Folder | undefined, b: Folder): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(
    (key) =>
      (a[key as keyof Folder] ?? null) === (b[key as keyof Folder] ?? null),
  );
}

/**
 * 서버와 병합한 폴더 목록으로 교체하고 저장한다 (부팅 동기화).
 * `removedIds`는 다른 기기에서 영구 삭제된 폴더다 — 대기 중인 push를 버리고 로컬
 * 저장본에서도 지운다. push가 남으면 연결이 돌아올 때 서버에서 되살아난다.
 *
 * 지금 폴더와 내용이 다른 폴더만 쓴다. 병합은 시각이 같으면 서버 객체를 고르므로 객체만 견주면
 * 부팅마다 모든 폴더를 다시 쓰고, 쓴 폴더마다 다른 탭이 저장본을 다시 읽는다.
 *
 * 저장본을 읽지 못했으면 메모리만 바꾸고 저장소에는 쓰지 않는다. 읽지 못한 저장본을 병합
 * 결과로 덮으면 그 안에 있던, 아직 올리지 못한 폴더를 잃는다.
 */
export async function applyServerFolders(
  next: Folder[],
  removedIds: readonly string[] = [],
): Promise<void> {
  for (const id of removedIds) cancelFolderPush(id);
  const previous = new Map(folders.map((folder) => [folder.id, folder]));
  const userId = getCurrentUserId();
  const mine = userId ? next.filter((folder) => folder.userId === userId) : [];
  setFolders(mine);
  if (hydrationFailed) return;
  const changed = mine.filter(
    (folder) => !isSameFolder(previous.get(folder.id), folder),
  );
  if (changed.length > 0) {
    queueWrite(
      changed.map((folder) => folder.id),
      "save",
      () => saveFolders(changed),
    );
  }
  if (removedIds.length > 0) {
    queueWrite(removedIds, "delete", () => deleteFolders(removedIds));
  }
  await writes;
}

function adoptsServerFolder(local: Folder, server: Folder): boolean {
  if (
    local.parentId === server.parentId &&
    local.name === server.name &&
    local.trashedAt === server.trashedAt
  ) {
    return (
      local.updatedAt !== server.updatedAt ||
      local.createdAt !== server.createdAt
    );
  }
  return local.updatedAt <= server.updatedAt || isFarFuture(local.updatedAt);
}

/**
 * 서버가 확정한 폴더 1건(push 응답)을 반영한다.
 *
 * - 서버본이 로컬과 같거나 늦은 시각이면 따른다. 서버가 부모를 보정했거나, 이 수정보다 늦게 고친
 *   다른 기기의 폴더를 돌려준 것이다(서버는 늦게 온 옛 수정을 쓰지 않는다).
 * - 이름·부모·휴지통이 같고 시각만 다르면 서버 시각을 따른다. 서버가 기기 시각을 줄인 값이라,
 *   따르지 않으면 다음 부팅 병합에서 로컬 시각이 이겨 같은 폴더를 다시 올린다.
 * - 로컬 시각이 기기 시계보다 한참 앞서면(`isFarFuture`) 서버본을 따른다. 빠른 시계가 남긴 값이라
 *   로컬이 더 새롭다고 볼 수 없다(`mergeFolders`도 서버본을 고른다). 서버본으로 바로 맞추고,
 *   이 값을 읽는 이전 버전의 탭이 병합에서 다시 올리지 않게 저장본도 고친다.
 * - 그 밖에 로컬이 더 늦고 내용이 다르면 무시한다. 그사이 로컬에서 더 고쳤거나 지웠고, 그 변경도
 *   곧 올라간다.
 */
export function applyServerFolder(serverFolder: Folder): void {
  const local = index.byId.get(serverFolder.id);
  if (!local || !adoptsServerFolder(local, serverFolder)) return;
  setFolders(
    folders.map((folder) =>
      folder.id === serverFolder.id ? serverFolder : folder,
    ),
  );
  queueWrite([serverFolder.id], "save", () => saveFolder(serverFolder));
}

/** 영구 삭제가 끝난 폴더를 메모리와 저장소에서 지운다 */
export async function removeFoldersLocally(
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const removed = new Set(ids);
  for (const id of removed) cancelFolderPush(id);
  setFolders(folders.filter((folder) => !removed.has(folder.id)));
  queueWrite(ids, "delete", () => deleteFolders(ids));
  await writes;
}

/**
 * 다른 탭이 IndexedDB에 쓰거나 지운 폴더를 저장본에서 다시 읽어 메모리를 맞춘다
 * (`storageSync`가 부른다). 맞추지 않으면 이 탭의 낡은 폴더가 다음 이름 바꾸기·이동 때 다른 탭의
 * 휴지통·이동을 되돌린다.
 *
 * 세션 사용자의 폴더를 저장본으로 바꾸거나 더한다. 이 탭이 아직 저장하지 않았거나 저장하는 중인
 * 폴더는 건너뛴다(읽는 동안 고친 폴더도 같다). 곧 이 탭의 쓰기가 저장본을 다시 쓴다. 저장본이
 * 없으면 다른 탭에서 영구 삭제한 것이라 메모리에서 빼고 대기 중인 push를 버린다. 남은 push가 지운
 * 폴더를 서버에 되살린다. 읽지 못한 저장본은 지운 것이 아니라 그대로 둔다. 저장도 push도 하지
 * 않는다. 폴더를 읽지 못한 탭(하이드레이션 실패)은 다시 읽지 않는다.
 *
 * 읽은 뒤 `isPaused()`가 참이면(그사이 송출을 시작함) 아무것도 바꾸지 않고 읽은 id를 돌려준다.
 * 부른 쪽이 모아 두었다가 송출을 마친 뒤 다시 읽는다. 그 밖에는 빈 목록이다.
 */
export async function reloadFoldersFromStorage(
  ids: readonly string[],
  isPaused: () => boolean = () => false,
): Promise<string[]> {
  if (hydrationFailed) return [];
  const unique = [...new Set(ids)].filter((id) => !unpersisted.has(id));
  if (unique.length === 0) return [];
  let loaded: { id: string; record: LoadedRecord<Folder> }[];
  try {
    loaded = await Promise.all(
      unique.map(async (id) => ({ id, record: await loadFolder(id) })),
    );
  } catch {
    return [];
  }
  if (isPaused()) return unique;

  const userId = getCurrentUserId();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let changed = false;
  for (const { id, record } of loaded) {
    if (unpersisted.has(id)) continue;
    if (record.status === "missing") {
      cancelFolderPush(id);
      if (byId.delete(id)) changed = true;
      continue;
    }
    if (record.status === "unreadable" || record.value.userId !== userId) {
      continue;
    }
    byId.set(id, record.value);
    changed = true;
  }
  if (changed) setFolders([...byId.values()]);
  return [];
}

/** 대기 중인 저장이 끝날 때까지 기다린다 (테스트·언로드용) */
export function flushFolderWrites(): Promise<void> {
  return writes;
}

/** 테스트 격리 전용 */
export function resetFolderStore(): void {
  writes = Promise.resolve();
  unpersisted.clear();
  hydrationFailed = false;
  writeRetry.reset();
  setFolders([]);
}

/** 테스트 전용: 저장 없이 메모리에 싣는다 */
export function __loadFoldersForTests(next: Folder[]): void {
  setFolders(next.map((folder) => ({ ...folder })));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 트리 인덱스 (폴더 목록이 바뀔 때만 새로 만든다) */
export function useFolderIndex(): FolderIndex<Folder> {
  return useSyncExternalStore(subscribe, getFolderIndex, getFolderIndex);
}
