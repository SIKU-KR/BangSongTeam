import { useSyncExternalStore } from "react";
import {
  buildFolderIndex,
  createId,
  folderNameKey,
  isFolderTrashed,
  resolveUniqueName,
  wouldCreateCycle,
  type Folder,
  type FolderIndex,
} from "@repo/shared";
import {
  saveFolder,
  saveFolders,
  loadAllFolders,
  deleteFolders,
  reportPersistenceError,
  reportCorruptedRecords,
} from "../../lib/storage";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import {
  scheduleFolderPush,
  cancelFolderPush,
} from "../../lib/sync/folderSync";

/**
 * 드라이브 폴더 스토어 (홈 `/presentations`의 폴더 트리).
 *
 * 프레젠테이션 스토어와 같은 오프라인 우선 규칙을 따른다. 바뀐 폴더는 곧바로
 * IndexedDB에 쓰고, 서버 push는 `folderSync` 큐가 디바운스를 두고 뒤따른다.
 *
 * 이름 규칙은 파일 탐색기와 같다. 같은 위치의 폴더끼리는 이름이 겹치지 않는다
 * (대소문자·앞뒤 공백 무시). 휴지통에 있는 폴더는 자리를 차지하지 않는다.
 */

export const DEFAULT_FOLDER_NAME = "새 폴더";
const MAX_NAME_LENGTH = 100;

export type FolderMutationResult =
  { ok: true; folder: Folder } | { ok: false; error: string };

let folders: Folder[] = [];
let index: FolderIndex<Folder> = buildFolderIndex(folders);
const listeners = new Set<() => void>();
let writes: Promise<void> = Promise.resolve();

function setFolders(next: Folder[]): void {
  folders = next;
  index = buildFolderIndex(next);
  for (const listener of listeners) listener();
}

function queueWrite(write: () => Promise<void>): void {
  writes = writes.then(write).catch((err: unknown) => {
    reportPersistenceError(err);
  });
}

function commit(changed: Folder[]): void {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of changed) byId.set(folder.id, folder);
  setFolders([...byId.values()]);

  for (const folder of changed) {
    queueWrite(() => saveFolder(folder));
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

function siblingNames(parentId: string | null, excludeId?: string): string[] {
  return (index.childrenOf.get(parentId) ?? [])
    .filter((folder) => folder.id !== excludeId && !folder.trashedAt)
    .map((folder) => folder.name);
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
  name: string = DEFAULT_FOLDER_NAME,
): Folder {
  const parent = resolveTargetParent(parentId);
  const timestamp = now();
  const folder: Folder = {
    id: createId(),
    userId: getCurrentUserId() ?? "",
    parentId: parent,
    name: resolveUniqueName(
      name.trim() || DEFAULT_FOLDER_NAME,
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
  if (!trimmed) return "이름을 입력하세요";
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `이름은 ${MAX_NAME_LENGTH}자까지 쓸 수 있습니다`;
  }
  const key = folderNameKey(trimmed);
  if (siblingNames(parentId, excludeId).some((n) => folderNameKey(n) === key)) {
    return "같은 위치에 같은 이름의 폴더가 있습니다";
  }
  return null;
}

/** 이름 바꾸기. 같은 위치에 같은 이름이 있으면 거절한다 (파일 탐색기와 같다) */
export function renameFolder(id: string, name: string): FolderMutationResult {
  const folder = index.byId.get(id);
  if (!folder) return { ok: false, error: "폴더를 찾을 수 없습니다" };

  const parentId = index.parentOf.get(id) ?? null;
  const error = validateFolderName(name, parentId, id);
  if (error) return { ok: false, error };

  const trimmed = name.trim();
  if (trimmed === folder.name) return { ok: true, folder };

  const next = { ...folder, name: trimmed, updatedAt: now() };
  commit([next]);
  return { ok: true, folder: next };
}

/**
 * 폴더 이동. 자기 자신이나 하위 폴더로는 옮길 수 없다.
 * 옮겨 간 곳에 같은 이름이 있으면 번호를 붙인다.
 */
export function moveFolder(
  id: string,
  parentId: string | null,
): FolderMutationResult {
  const folder = index.byId.get(id);
  if (!folder) return { ok: false, error: "폴더를 찾을 수 없습니다" };
  if (parentId !== null && !isFolderAvailable(parentId)) {
    return { ok: false, error: "옮길 폴더를 찾을 수 없습니다" };
  }
  if (wouldCreateCycle(index, id, parentId)) {
    return { ok: false, error: "폴더를 자기 안으로 옮길 수 없습니다" };
  }
  if ((index.parentOf.get(id) ?? null) === parentId) {
    return { ok: true, folder };
  }

  const next: Folder = {
    ...folder,
    parentId,
    name: resolveUniqueName(folder.name, siblingNames(parentId, id)),
    updatedAt: now(),
  };
  commit([next]);
  return { ok: true, folder: next };
}

/** 휴지통으로. 하위 항목은 조상 기준으로 함께 가려진다 (따로 표시하지 않는다) */
export function trashFolder(id: string): void {
  const folder = index.byId.get(id);
  if (!folder || folder.trashedAt) return;
  const timestamp = now();
  commit([{ ...folder, trashedAt: timestamp, updatedAt: timestamp }]);
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
      updatedAt: now(),
    },
  ]);
}

/** 저장본으로 폴더를 복원한다. 세션 사용자의 폴더만 싣는다 */
export async function hydrateFoldersFromStorage(): Promise<void> {
  const userId = getCurrentUserId();
  try {
    const { valid, corrupted } = await loadAllFolders();
    reportCorruptedRecords(corrupted);
    setFolders(
      userId ? valid.filter((folder) => folder.userId === userId) : [],
    );
  } catch (err) {
    reportPersistenceError(err);
    setFolders([]);
  }
}

/**
 * 서버와 병합한 폴더 목록으로 교체하고 저장한다 (부팅 동기화).
 * `removedIds`는 다른 기기에서 영구 삭제된 폴더다 — 로컬 저장본에서도 지운다.
 */
export async function applyServerFolders(
  next: Folder[],
  removedIds: readonly string[] = [],
): Promise<void> {
  const userId = getCurrentUserId();
  const mine = userId ? next.filter((folder) => folder.userId === userId) : [];
  setFolders(mine);
  queueWrite(async () => {
    await saveFolders(mine);
    await deleteFolders(removedIds);
  });
  await writes;
}

/**
 * 서버가 확정한 폴더 1건(push 응답)을 반영한다.
 * 그사이 로컬에서 더 고쳤거나 지웠으면 무시한다 — 그 변경도 곧 올라간다.
 */
export function applyServerFolder(serverFolder: Folder): void {
  const local = index.byId.get(serverFolder.id);
  if (!local || local.updatedAt > serverFolder.updatedAt) return;
  if (
    local.parentId === serverFolder.parentId &&
    local.name === serverFolder.name &&
    local.trashedAt === serverFolder.trashedAt
  ) {
    return;
  }
  setFolders(
    folders.map((folder) =>
      folder.id === serverFolder.id ? serverFolder : folder,
    ),
  );
  queueWrite(() => saveFolder(serverFolder));
}

/** 영구 삭제가 끝난 폴더를 메모리와 저장소에서 지운다 */
export async function removeFoldersLocally(
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const removed = new Set(ids);
  for (const id of removed) cancelFolderPush(id);
  setFolders(folders.filter((folder) => !removed.has(folder.id)));
  queueWrite(() => deleteFolders(ids));
  await writes;
}

/** 대기 중인 저장이 끝날 때까지 기다린다 (테스트·언로드용) */
export function flushFolderWrites(): Promise<void> {
  return writes;
}

/** 테스트 격리 전용 */
export function resetFolderStore(): void {
  writes = Promise.resolve();
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

export function useFolders(): Folder[] {
  return useSyncExternalStore(subscribe, getFolders, getFolders);
}

/** 트리 인덱스 (폴더 목록이 바뀔 때만 새로 만든다) */
export function useFolderIndex(): FolderIndex<Folder> {
  return useSyncExternalStore(subscribe, getFolderIndex, getFolderIndex);
}
