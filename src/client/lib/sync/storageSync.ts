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

type Reload = (
  ids: readonly string[],
  isPaused: () => boolean,
) => Promise<string[]>;

const reloaders: Record<StorageChangeKind, Reload> = {
  presentations: reloadPresentationsFromStorage,
  folders: reloadFoldersFromStorage,
  decks: reloadSongsFromStorage,
};

const held: Record<StorageChangeKind, Set<string>> = {
  presentations: new Set(),
  folders: new Set(),
  decks: new Set(),
};
let heldUserId: string | null = null;

const queues: Record<StorageChangeKind, Promise<void>> = {
  presentations: Promise.resolve(),
  folders: Promise.resolve(),
  decks: Promise.resolve(),
};

let unsubscribe: (() => void) | null = null;
let started = false;

function clearHeld(): void {
  for (const kind of KINDS) held[kind].clear();
  heldUserId = null;
}

function hold(
  userId: string,
  kind: StorageChangeKind,
  ids: readonly string[],
): void {
  if (ids.length === 0) return;
  if (heldUserId !== userId) {
    clearHeld();
    heldUserId = userId;
  }
  for (const id of ids) held[kind].add(id);
}

function reload(
  userId: string,
  kind: StorageChangeKind,
  ids: readonly string[],
): void {
  queues[kind] = queues[kind]
    .then(async () => {
      if (isProjecting()) {
        hold(userId, kind, ids);
        return;
      }
      hold(userId, kind, await reloaders[kind](ids, isProjecting));
    })
    .catch(() => undefined);
}

function onStorageChange(change: StorageChange): void {
  if (change.userId !== getCurrentUserId()) return;
  if (!started || isProjecting()) {
    hold(change.userId, change.kind, change.ids);
    return;
  }
  reload(change.userId, change.kind, change.ids);
}

/**
 * 다른 탭의 저장 알림을 듣기 시작하되, 다시 읽지는 않고 모아 둔다. 스토어를 저장본에서 싣기
 * (하이드레이션) 전에 부른다.
 *
 * 싣기는 저장본 전체를 한 번 읽고 그 결과로 메모리를 채운다. 읽은 뒤 채우기 전, 또는 채운 뒤 듣기
 * 전에 다른 탭이 쓴 저장본은 알림을 놓치면 그 저장본을 다시 쓸 때까지 낡은 사본으로 남고, 이 탭의
 * 다음 편집이 그 저장본을 덮는다. 모은 알림은 `startStorageSync`가 다시 읽는다. 여러 번 불러도 한
 * 번만 듣는다.
 */
export function listenForStorageChanges(): void {
  unsubscribe ??= subscribeStorageChanges(onStorageChange);
}

/**
 * 같은 브라우저의 다른 탭이 IndexedDB에 쓰거나 지운 프레젠테이션·폴더·곡을 이 탭의 스토어가 다시
 * 읽게 한다. 다시 읽지 않으면 이 탭의 낡은 메모리 사본이 다음 편집 때 다른 탭의 수정을 저장소와
 * 서버에서 덮는다.
 *
 * 스토어를 싣고 세션 사용자를 다시 확인한 뒤 부른다. 듣기 전이면 듣기 시작하고, 싣는 동안 모아 둔
 * 알림을 다시 읽는다(`listenForStorageChanges`). 다른 사용자의 알림은 따르지 않고, 모은 뒤 사용자가
 * 바뀌었으면 모은 알림을 버린다. 같은 종류는 받은 순서대로 앞의 다시 읽기가 끝난 뒤에 읽어, 늦게
 * 끝난 읽기가 새 저장본을 옛 저장본으로 되돌리지 않게 한다.
 *
 * 송출 중에는 다시 읽지 않고 id를 모아 두었다가 송출을 마치면(`resumeHeldStorageChanges`) 다시
 * 읽는다. 송출 화면은 띄운 프레젠테이션의 변경을 따라 그리므로, 다른 탭의 수정이 송출 중인 화면을
 * 바꾸면 안 된다. 송출 직전에 시작한 다시 읽기와 그 뒤에 줄 선 다시 읽기도 송출이 시작됐으면 싣지
 * 않고 모은다. 송출 주소로 부팅한 탭도 송출 동안 받은 알림을 놓치지 않도록 부팅 동기화보다 먼저
 * 부른다.
 */
export function startStorageSync(): void {
  listenForStorageChanges();
  started = true;
  resumeHeldStorageChanges();
}

/**
 * 송출하는 동안 모아 둔 다른 탭의 변경을 다시 읽는다. 송출 화면을 떠났을 때 부르고, 아직 송출
 * 중이거나 `startStorageSync` 전이면 아무것도 하지 않는다.
 */
export function resumeHeldStorageChanges(): void {
  if (!started || isProjecting() || heldUserId === null) return;
  const userId = heldUserId;
  if (userId !== getCurrentUserId()) {
    clearHeld();
    return;
  }
  for (const kind of KINDS) {
    if (held[kind].size === 0) continue;
    const ids = [...held[kind]];
    held[kind].clear();
    reload(userId, kind, ids);
  }
}

export function __resetStorageSyncForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  clearHeld();
  for (const kind of KINDS) queues[kind] = Promise.resolve();
}
