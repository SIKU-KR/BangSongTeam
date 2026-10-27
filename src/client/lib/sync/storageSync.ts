import {
  StorageChangeKindSchema,
  type StorageChange,
  type StorageChangeKind,
} from "#shared";
import { getCurrentUserId } from "../auth/sessionStore";
import { subscribeStorageChanges } from "../storage/storageChannel";
import { isProjecting } from "../../features/presentation/fullscreen";
import { reloadPresentationsFromStorage } from "../../features/presentation/presentationStore";
import { reloadFoldersFromStorage } from "../../features/drive/folderStore";
import { reloadSongsFromStorage } from "../../features/editor/songLibraryStore";

const KINDS = StorageChangeKindSchema.options;

const reloaders: Record<
  StorageChangeKind,
  (ids: readonly string[]) => Promise<void>
> = {
  presentations: reloadPresentationsFromStorage,
  folders: reloadFoldersFromStorage,
  decks: reloadSongsFromStorage,
};

const held: Record<StorageChangeKind, Set<string>> = {
  presentations: new Set(),
  folders: new Set(),
  decks: new Set(),
};

const queues: Record<StorageChangeKind, Promise<void>> = {
  presentations: Promise.resolve(),
  folders: Promise.resolve(),
  decks: Promise.resolve(),
};

let unsubscribe: (() => void) | null = null;

function reload(kind: StorageChangeKind, ids: readonly string[]): void {
  queues[kind] = queues[kind]
    .then(() => reloaders[kind](ids))
    .catch(() => undefined);
}

function onStorageChange(change: StorageChange): void {
  if (change.userId !== getCurrentUserId()) return;
  if (isProjecting()) {
    for (const id of change.ids) held[change.kind].add(id);
    return;
  }
  reload(change.kind, change.ids);
}

/**
 * 같은 브라우저의 다른 탭이 IndexedDB에 쓰거나 지운 프레젠테이션·폴더·곡을 이 탭의 스토어가 다시
 * 읽게 한다. 다시 읽지 않으면 이 탭의 낡은 메모리 사본이 다음 편집 때 다른 탭의 수정을 저장소와
 * 서버에서 덮는다.
 *
 * 스토어를 싣고 나서 한 번 부른다. 여러 번 불러도 한 번만 듣는다. 다른 사용자의 알림은 따르지
 * 않는다. 같은 종류는 받은 순서대로 앞의 다시 읽기가 끝난 뒤에 읽어, 늦게 끝난 읽기가 새 저장본을
 * 옛 저장본으로 되돌리지 않게 한다.
 *
 * 송출 중에 받은 id는 모아 두었다가 송출을 마치면(`resumeHeldStorageChanges`) 다시 읽는다. 송출
 * 화면은 띄운 프레젠테이션의 변경을 따라 그리므로, 다른 탭의 수정이 송출 중인 화면을 바꾸면 안
 * 된다. 송출 주소로 부팅한 탭도 송출 동안 받은 알림을 놓치지 않도록 부팅 동기화보다 먼저 듣는다.
 */
export function startStorageSync(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeStorageChanges(onStorageChange);
}

/**
 * 송출하는 동안 모아 둔 다른 탭의 변경을 다시 읽는다. 송출 화면을 떠났을 때 부르고, 아직 송출
 * 중이면 아무것도 하지 않는다.
 */
export function resumeHeldStorageChanges(): void {
  if (isProjecting()) return;
  for (const kind of KINDS) {
    if (held[kind].size === 0) continue;
    const ids = [...held[kind]];
    held[kind].clear();
    reload(kind, ids);
  }
}

export function __resetStorageSyncForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  for (const kind of KINDS) {
    held[kind].clear();
    queues[kind] = Promise.resolve();
  }
}
