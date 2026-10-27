import { useSyncExternalStore } from "react";
import {
  listPresentations,
  applyServerDocuments,
} from "../../features/presentation";
import {
  getFolders,
  applyServerFolders,
  applyServerFolder,
} from "../../features/drive/folderStore";
import {
  sortFoldersParentFirst,
  type Deck,
  type DriveTombstones,
  type Folder,
} from "#shared";
import { planBootMerge } from "./mergeDocuments";
import { mergeFolders } from "./mergeFolders";
import {
  getUserSongs,
  getDeletedSongIds,
  applyServerLibraryDecks,
  applyServerDeckFields,
  dropDeletedLibraryDeck,
  resumeSongDeletes,
} from "../../features/editor/songLibraryStore";
import { mergeLibraryDecks } from "./mergeLibraryDecks";
import { sharedPresentationListener } from "./sharedPresentationListener";
import {
  pullPresentations,
  pushPresentation,
  rememberServerDocuments,
  setSharedPresentationListener,
  pullDecks,
  pullFolders,
  syncFailureReasonOf,
} from "./presentationSync";
import {
  isRetryableApiError,
  requestIdOfError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import {
  BackoffTracker,
  BASE_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  type SyncRetryMode,
} from "./backoff";
import {
  setFolderSyncEnabled,
  setServerFolderListener,
  pushFolderNow,
  hasPendingFolderPush,
  holdFailedFolderPush,
  scheduleFolderPush,
  cancelFolderPush,
} from "./folderSync";
import {
  getSyncDomainStatus,
  recordSyncFailure,
  resetSyncStatus,
  setSyncStatus,
  type SyncDomain,
  type SyncStatus,
} from "./syncStatus";
import {
  cancelDocumentPush,
  hasPendingDocumentPush,
  holdFailedDocumentPush,
  scheduleDocumentPush,
  setSyncEnabled,
} from "./syncScheduler";
import {
  setDeckSyncEnabled,
  setServerDeckListener,
  setDeckGoneListener,
  pushDeckNow,
  hasPendingDeckSync,
  holdFailedDeckPush,
  scheduleDeckPush,
  cancelDeckPush,
  isDeckDeletedError,
} from "./deckSync";
import { refreshBackgroundCatalog } from "./backgroundSync";
import { isProjectionPath } from "../../features/presentation/fullscreen";
import { getCurrentUserId, revalidateSession } from "../auth/sessionStore";

/**
 * 송출 중 새로고침하면 부팅 경로를 처음부터 다시 탄다. 여기서 서버와 맞추면
 * 송출 중 API·데이터 요청 0건이 깨지므로, 송출 화면에서는 부팅 동기화를 돌리지 않는다.
 */
export function shouldRunBootSync(pathname: string): boolean {
  return !isProjectionPath(pathname);
}

let deferredBootUserId: string | null = null;

/**
 * 로컬 하이드레이션을 마친 뒤 부팅 동기화를 시작한다. 송출 화면에서 부팅했으면 돌리지 않고
 * 지금 사용자로 미뤄 두었다가, 송출을 마치면 `runDeferredBootSync`가 한 번 돌린다.
 *
 * 부팅 동기화만 세 큐(폴더·프레젠테이션·곡)를 켠다. 미뤄 둔 부팅을 아무도 돌리지 않으면 송출을
 * 마친 같은 탭에서 고친 프레젠테이션·곡·폴더가 새로고침할 때까지 서버에 가지 않고, 헤더는 그동안
 * 초록색 '자동 저장됨'으로 남는다. 다른 계정이 부팅하면 미뤄 둔 앞 계정의 부팅은 버린다.
 *
 * 화면이 주소의 항목을 그리기 전에 불러야 한다. 부팅이 시작될 때 세우는 첫 받기 표시
 * (`useBootPullPending`)를 보고, 아직 받지 않은 프레젠테이션·폴더 주소를 드라이브로 보내지 않는다.
 */
export function startBootSync(pathname: string): void {
  deferredBootUserId = null;
  if (!shouldRunBootSync(pathname)) {
    deferredBootUserId = getCurrentUserId();
    return;
  }
  void runBootSync();
}

/**
 * 송출 화면을 떠났을 때 부른다. 송출 화면에서 부팅해 미뤄 둔 부팅 동기화가 같은 사용자의
 * 것이면 지금 한 번 돌린다. 송출 중이거나 미뤄 둔 부팅이 없으면 아무것도 하지 않는다.
 *
 * 세션도 보통 부팅처럼 함께 확인한다. 송출 화면의 부팅은 만료된 캐시 세션도 서버에 묻지 않고
 * 통과시킨다. 확인하지 않으면 받기·올리기가 모두 401로 실패하는데, 401은 세션 상태를 바꾸지
 * 않아 로그인 화면이 뜨지 않는다. 확인을 기다렸다가 부팅하지 않는 것은 그동안 큐가 꺼져 있어
 * 지운 곡을 잃기 때문이다.
 *
 * 로그아웃된 채 떠났으면 미뤄 둔 부팅을 그대로 둔다. 같은 계정으로 다시 로그인하면 하이드레이션을
 * 다시 하지 않으므로, 다시 그린 화면이 이 함수를 불러 그때 돌린다.
 */
export function runDeferredBootSync(): void {
  if (deferredBootUserId === null || isProjecting()) return;
  if (getCurrentUserId() !== deferredBootUserId) return;
  deferredBootUserId = null;
  void revalidateSession();
  void runBootSync();
}

/** 부팅 동기화가 첫 받기를 마칠 때까지 주소로 연 항목을 기다리는 도메인 */
export type BootPullDomain = "folder" | "presentation";

/**
 * 첫 받기를 기다리는 최대 시간. 프레젠테이션 받기는 폴더 받기(최대 30초)와 부팅이 올리는 폴더
 * (하나에 최대 10초) 뒤에 오므로, 기한이 없으면 느린 회선에서 1분 넘게 기다릴 수 있다.
 */
export const BOOT_PULL_WAIT_MS = 10_000;

const pendingBootPulls = new Set<BootPullDomain>();
const bootPullListeners = new Set<() => void>();
let bootPullTimer: ReturnType<typeof setTimeout> | null = null;

function notifyBootPull(): void {
  for (const listener of bootPullListeners) listener();
}

function subscribeBootPull(listener: () => void): () => void {
  bootPullListeners.add(listener);
  return () => {
    bootPullListeners.delete(listener);
  };
}

function clearBootPullTimer(): void {
  if (bootPullTimer) clearTimeout(bootPullTimer);
  bootPullTimer = null;
}

function markBootPullPending(generation: number): void {
  pendingBootPulls.add("folder");
  pendingBootPulls.add("presentation");
  clearBootPullTimer();
  bootPullTimer = setTimeout(() => {
    clearBootPull("folder", generation);
    clearBootPull("presentation", generation);
  }, BOOT_PULL_WAIT_MS);
  notifyBootPull();
}

function clearBootPull(domain: BootPullDomain, generation: number): void {
  if (generation !== bootGeneration) return;
  if (!pendingBootPulls.delete(domain)) return;
  if (pendingBootPulls.size === 0) clearBootPullTimer();
  notifyBootPull();
}

/** 지금 부팅 동기화가 그 도메인의 첫 받기를 기다리고 있는지 */
export function isBootPullPending(domain: BootPullDomain): boolean {
  return pendingBootPulls.has(domain);
}

/**
 * 부팅 동기화가 그 도메인의 첫 받기를 기다리는 동안 true다. 다른 기기에서 만들었거나 저장소를
 * 비운 기기에서 연 `/editor/:id`·폴더 주소는 첫 받기가 끝나야 항목이 생기므로, 그동안 드라이브로
 * 보내지 말고 기다리라는 뜻이다.
 *
 * 부팅이 시작될 때 두 도메인 모두 세우고, 폴더는 받은 폴더를 메모리에 넣자마자, 프레젠테이션은
 * 병합하자마자 내린다. 받기가 실패하거나 송출로 멈추거나 `BOOT_PULL_WAIT_MS`가 지나도 내린다.
 * 내리는 일은 모두 그 부팅의 세대일 때만 한다. 계정 전환 등으로 밀려난 부팅이 늦게 끝나며 새
 * 부팅의 기다림을 끝내면 안 된다.
 */
export function useBootPullPending(domain: BootPullDomain): boolean {
  return useSyncExternalStore(
    subscribeBootPull,
    () => pendingBootPulls.has(domain),
    () => false,
  );
}

/**
 * 부팅 시 서버와 한 번 맞춘다.
 *
 * **백그라운드로 돌린다.** 로컬 하이드레이션이 끝나면 곧바로 화면을 그리고,
 * 서버 병합은 그 뒤에 붙인다. 서버를 기다리느라 첫 화면이 늦어지면 네트워크가
 * 느린 교회에서 예배 시작이 그만큼 밀린다.
 *
 * 오프라인은 조용히 넘어간다 — 실패가 아니라 정상 경로다. 다만 받지 못한 단계는
 * 백오프 간격과 연결 회복(`retryBootSyncIfNeeded`)으로 다시 받고, 올리지 못한 항목은
 * 도메인 큐에 넘겨 큐의 백오프로 다시 올린다. 다시 하지 않으면 그 도메인이 세션 내내
 * '오프라인'으로 남아, 연결이 돌아와 저장이 다 끝나도 헤더가 초록색으로 돌아오지 않는다.
 * 송출 화면에 있는 동안에는 다시 받지 않고 송출을 마친 뒤로 미룬다. 송출 중에는
 * API·데이터 요청이 0건이어야 하고, 받은 결과를 병합하면 띄운 문서가 바뀔 수 있다.
 * 부팅 도중에 송출을 시작해도 같다. 받기마다 그 직전과 받은 직후에 송출 중이면 그 단계를
 * 받은 결과와 함께 내려놓고, 송출을 마친 뒤 처음부터 다시 받는다. 송출 화면은 지금 띄운
 * 프레젠테이션의 변경을 따라 그리므로, 그대로 병합하면 송출 중인 화면이 바뀌고 다음 요청이
 * 나간다. 병합을 마친 단계는 송출 중이어도 올릴 항목을 끝까지 올린다.
 *
 * 항목마다 올리기 직전과 큐에 넘기거나 실패로 남길 때 지금 저장소에 있는 것을 다시 찾아
 * 쓰고, 그사이 지워졌으면 건너뛴다. 부팅 병합 때의 사본을 올리면 앞 항목을 올리는 동안
 * 사용자가 지운 곡이 되살아나고, 바로 올리기는 큐에 대기 중인 같은 항목을 버리므로 그사이
 * 고친 내용(폴더 이름 등)이 다음 부팅까지 서버에 가지 않는다. 올리는 동안 지운 항목의 실패를
 * 남기면 '다시 시도'가 다시 올릴 항목이 없어 그 실패가 세션 내내 남는다.
 *
 * 병합 결과는 각 스토어의 저장 줄로 저장한다 (`applyServerDocuments` 등). 병합하자마자 기다림
 * 없이 지운 항목과 서버 사본이 이긴 항목의 대기 중인 push를 버린다. 대기 중인 사본은 방금
 * 서버와 견준 메모리보다 새로울 수 없으므로, 남겨 두면 연결이 돌아올 때 지운 항목을 서버에서
 * 되살리거나 서버의 새 사본을 옛 사본으로 덮는다. 지운 곡은 서버의 삭제 기록과 이 페이지에서
 * 지운 곡, 앞선 페이지에서 지우고 서버에서 아직 지우지 못한 곡을 모두 병합에서 뺀다. 앞선
 * 페이지의 삭제는 곡 큐를 켜자마자 기다림 없이 다시 넣어, 목록을 받지 못한 부팅에서도 큐의
 * 백오프로 다시 보낸다.
 *
 * 결과는 폴더·프레젠테이션·곡 도메인별로 따로 남기고, 올리지 못한 항목은 항목별
 * 실패로 남긴다. 도메인 단계만 바꾸면 같은 도메인 큐의 다음 성공이 그 실패를 덮는다.
 * 도메인 큐가 아직 끝내지 못한 일(보내는 중이거나 다시 시도할 것)이 있으면 그 결과는
 * 큐가 남긴다. 부팅의 '동기화됨'은 아직 올라가지 않은 변경을 가리고, 큐가 이미 다시
 * 올린 항목을 두고 남긴 '오프라인'은 지울 주체가 없어 세션 내내 남는다.
 * 상태 초기화는 큐를 켜기 전에 한다. 켠 뒤에 지우면 먼저 실패한 큐의 기록이 사라진다.
 * 다시 부르면(새로고침 없이 계정 전환) 앞선 부팅의 남은 단계는 상태를 남기지 않는다.
 */
export async function runBootSync(): Promise<void> {
  bootGeneration += 1;
  const generation = bootGeneration;
  markBootPullPending(generation);
  cancelBootRetry();
  resetSyncStatus();
  setSyncStatus("folder", "syncing");
  setSyncStatus("presentation", "syncing");
  setSyncStatus("deck", "syncing");
  setSharedPresentationListener(sharedPresentationListener);
  setSyncEnabled(true);
  setDeckSyncEnabled(true);
  resumeSongDeletes();
  setServerDeckListener(applyServerDeckFields);
  setDeckGoneListener(dropDeletedLibraryDeck);
  setFolderSyncEnabled(true);
  setServerFolderListener(applyServerFolder);
  void refreshBackgroundCatalog();

  try {
    await syncDriveAndDecks();
  } finally {
    clearBootPull("folder", generation);
    clearBootPull("presentation", generation);
  }
}

let bootGeneration = 0;

async function syncDriveAndDecks(): Promise<void> {
  const generation = bootGeneration;
  if (parkWhileProjecting(syncDriveAndDecks)) return;
  const knownBeforePull = new Set(listPresentations().map((doc) => doc.id));
  let serverDocuments;
  let tombstones: DriveTombstones;
  let unsynced: readonly SyncDomain[] = ["folder", "presentation", "deck"];
  try {
    const folderList = await pullFolders();
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncDriveAndDecks)) return;
    tombstones = folderList.tombstones;
    const folderStatus = await syncFolders(
      folderList.folders,
      tombstones,
      generation,
    );
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncDriveAndDecks)) return;
    settleSyncStatus("folder", folderStatus);
    unsynced = ["presentation", "deck"];
    serverDocuments = await pullPresentations();
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncDriveAndDecks)) return;
    rememberServerDocuments(serverDocuments);
    retryBackoff.reset();
  } catch (err) {
    if (generation !== bootGeneration) return;
    const status = retryPullLater(syncDriveAndDecks, err);
    for (const domain of unsynced) {
      setSyncStatus(domain, status, requestIdOfError(err));
    }
    return;
  }

  const { documents, needsPush, removedIds } = planBootMerge(
    listPresentations(),
    serverDocuments,
    tombstones.presentationIds,
    knownBeforePull,
  );
  cancelPushesOfServerWins(documents, needsPush, cancelDocumentPush);
  applyServerDocuments(documents, removedIds);
  clearBootPull("presentation", generation);

  const presentationStatus = await pushLatestEach(
    {
      domain: "presentation",
      current: listPresentations,
      push: pushPresentation,
      requeue: scheduleDocumentPush,
      hold: holdFailedDocumentPush,
      titleOf: (document) => document.title,
    },
    needsPush,
    generation,
  );
  if (generation !== bootGeneration) return;
  settleSyncStatus("presentation", presentationStatus);

  await syncLibraryDecks();
}

const hasQueuedWork: Record<Exclude<SyncDomain, "shared">, () => boolean> = {
  folder: hasPendingFolderPush,
  presentation: hasPendingDocumentPush,
  deck: hasPendingDeckSync,
};

function settleSyncStatus(
  domain: Exclude<SyncDomain, "shared">,
  next: SyncStatus,
): void {
  const queueBusy = hasQueuedWork[domain]();
  if (next === "synced" && queueBusy) return;
  if (next === "offline" && !queueBusy) {
    if (getSyncDomainStatus(domain) !== "syncing") return;
    setSyncStatus(domain, "synced");
    return;
  }
  setSyncStatus(domain, next);
}

const retryBackoff = new BackoffTracker();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep: (() => Promise<void>) | null = null;
let retryWaitsOnServer = false;
let abandonedStep: (() => Promise<void>) | null = null;

function cancelBootRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryStep = null;
  retryWaitsOnServer = false;
  abandonedStep = null;
  retryBackoff.reset();
}

function retryPullLater(step: () => Promise<void>, err: unknown): SyncStatus {
  if (
    !isRetryableApiError(err) ||
    (!(err instanceof OfflineError) &&
      retryBackoff.getServerAttempt() >= MAX_RETRY_ATTEMPTS)
  ) {
    retryBackoff.reset();
    abandonedStep = step;
    return "error";
  }
  abandonedStep = null;
  retryStep = step;
  retryWaitsOnServer = !(err instanceof OfflineError);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(runRetry, retryBackoff.getDelay(err));
  return "offline";
}

function isProjecting(): boolean {
  return (
    typeof window !== "undefined" && isProjectionPath(window.location.pathname)
  );
}

function parkWhileProjecting(step: () => Promise<void>): boolean {
  if (!isProjecting()) return false;
  retryStep = step;
  retryWaitsOnServer = false;
  abandonedStep = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(runRetry, BASE_BACKOFF_MS);
  return true;
}

function runRetry(): Promise<void> | null {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (isProjecting()) {
    if (retryStep) retryTimer = setTimeout(runRetry, BASE_BACKOFF_MS);
    return null;
  }
  const step = retryStep;
  retryStep = null;
  return step ? step().catch(() => undefined) : null;
}

/**
 * 부팅 때 받지 못한 단계가 백오프를 기다리고 있으면 지금 곧바로 다시 받고, 끝날 때까지
 * 기다린다. 다시 받았으면 true다. 기다리는 단계가 없거나 송출 중이면 요청 없이 false다.
 *
 * 연결 회복(`syncRecovery`)이 도메인 큐보다 먼저 부른다. 받지 못한 단계는 어느 큐에도
 * 들어 있지 않아, 회복을 알아도 백오프 타이머가 끝날 때까지(최대 1분) 헤더가
 * '오프라인'으로 남는다. 먼저 받아 병합해야 큐가 병합 결과를 올린다.
 *
 * `wake`는 서버가 거절해(5xx·429) 기다리는 단계를 앞당기지 않고 백오프 횟수도 그대로
 * 둔다. 포커스마다 목록 전체를 다시 받으면 장애 중인 서버를 더 누른다. `manual`은 서버
 * 재시도 한도에 이르렀거나 거절돼 포기한 단계도 다시 받는다.
 */
export async function retryBootSyncIfNeeded(
  mode: SyncRetryMode,
): Promise<boolean> {
  if (isProjecting()) return false;
  if (mode === "manual" && !retryStep && abandonedStep) {
    retryStep = abandonedStep;
    abandonedStep = null;
  }
  if (!retryStep) return false;
  if (mode === "wake" && retryWaitsOnServer) return false;
  if (mode !== "wake") retryBackoff.reset();
  const running = runRetry();
  if (!running) return false;
  await running;
  return true;
}

function cancelPushesOfServerWins(
  merged: readonly { id: string }[],
  needsPush: readonly string[],
  cancel: (id: string) => void,
): void {
  const localWins = new Set(needsPush);
  for (const { id } of merged) {
    if (!localWins.has(id)) cancel(id);
  }
}

async function syncFolders(
  serverFolders: Folder[],
  tombstones: DriveTombstones,
  generation: number,
): Promise<SyncStatus> {
  const deletedIds = new Set(tombstones.folderIds);
  const local = getFolders();
  const { folders, needsPush } = mergeFolders(
    local.filter((folder) => !deletedIds.has(folder.id)),
    serverFolders,
  );
  cancelPushesOfServerWins(folders, needsPush, cancelFolderPush);
  const applied = applyServerFolders(
    folders,
    local.filter((folder) => deletedIds.has(folder.id)).map((f) => f.id),
  );
  clearBootPull("folder", generation);
  await applied;

  const toPush = new Set(needsPush);
  return pushLatestEach(
    {
      domain: "folder",
      current: getFolders,
      push: pushFolderNow,
      requeue: scheduleFolderPush,
      hold: holdFailedFolderPush,
      titleOf: (folder) => folder.name,
    },
    sortFoldersParentFirst(
      folders.filter((candidate) => toPush.has(candidate.id)),
      folders,
    ).map((folder) => folder.id),
    generation,
  );
}

async function pushLibraryDeckAtBoot(deck: Deck): Promise<void> {
  try {
    await pushDeckNow(deck);
  } catch (err) {
    if (!isDeckDeletedError(err)) throw err;
    dropDeletedLibraryDeck(deck.id);
  }
}

async function syncLibraryDecks(): Promise<void> {
  const generation = bootGeneration;
  if (parkWhileProjecting(syncLibraryDecks)) return;
  let pull;
  try {
    pull = await pullDecks();
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncLibraryDecks)) return;
    retryBackoff.reset();
  } catch (err) {
    if (generation !== bootGeneration) return;
    setSyncStatus(
      "deck",
      retryPullLater(syncLibraryDecks, err),
      requestIdOfError(err),
    );
    return;
  }

  const deletedIds = new Set([...pull.deletedIds, ...getDeletedSongIds()]);
  const { decks, needsPush, removedIds } = mergeLibraryDecks(
    getUserSongs(),
    pull.decks,
    { deletedIds },
  );
  for (const id of deletedIds) cancelDeckPush(id);
  cancelPushesOfServerWins(decks, needsPush, cancelDeckPush);
  await applyServerLibraryDecks(decks, removedIds);

  const deckStatus = await pushLatestEach(
    {
      domain: "deck",
      current: getUserSongs,
      push: pushLibraryDeckAtBoot,
      requeue: scheduleDeckPush,
      hold: holdFailedDeckPush,
      titleOf: (deck) => deck.title,
    },
    needsPush,
    generation,
  );
  if (generation !== bootGeneration) return;
  settleSyncStatus("deck", deckStatus);
}

interface BootPushTarget<T extends { id: string }> {
  domain: SyncDomain;
  current: () => readonly T[];
  push: (item: T) => Promise<unknown>;
  requeue: (item: T) => void;
  hold: (item: T) => void;
  titleOf: (item: T) => string;
}

function findLatest<T extends { id: string }>(
  current: () => readonly T[],
  id: string,
): T | undefined {
  return current().find((candidate) => candidate.id === id);
}

async function pushLatestEach<T extends { id: string }>(
  target: BootPushTarget<T>,
  ids: readonly string[],
  generation: number,
): Promise<SyncStatus> {
  let sessionExpired = false;
  let offline = false;
  for (const id of ids) {
    if (generation !== bootGeneration) break;
    const item = findLatest(target.current, id);
    if (!item) continue;
    try {
      await target.push(item);
    } catch (err) {
      if (generation !== bootGeneration) break;
      if (err instanceof SessionExpiredError) {
        sessionExpired = true;
      } else if (isRetryableApiError(err)) {
        offline = true;
        const latest = findLatest(target.current, id);
        if (latest) target.requeue(latest);
      } else {
        const latest = findLatest(target.current, id);
        if (!latest) continue;
        target.hold(latest);
        recordSyncFailure({
          id: item.id,
          title: target.titleOf(item),
          kind: target.domain,
          status: err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
          requestId: requestIdOfError(err),
          reason: syncFailureReasonOf(err),
        });
      }
    }
  }
  if (sessionExpired) return "error";
  return offline ? "offline" : "synced";
}

export function __resetBootSyncForTests(): void {
  cancelBootRetry();
  deferredBootUserId = null;
  pendingBootPulls.clear();
  clearBootPullTimer();
  notifyBootPull();
}

/** 테스트 전용: 첫 받기를 기다리는 도메인을 정한다 (기한 타이머 없이) */
export function __setBootPullPendingForTests(
  domains: readonly BootPullDomain[],
): void {
  pendingBootPulls.clear();
  for (const domain of domains) pendingBootPulls.add(domain);
  clearBootPullTimer();
  notifyBootPull();
}
