import { useSyncExternalStore } from "react";
import {
  listPresentations,
  applyServerDocuments,
  getPresentationById,
} from "../../features/presentation";
import { mayDifferFromStorage } from "../../features/presentation/presentationStore";
import {
  getFolder,
  getFolders,
  applyServerFolders,
  applyServerFolder,
  removeFoldersLocally,
} from "../../features/drive/folderStore";
import {
  sortFoldersParentFirst,
  type Deck,
  type DriveTombstones,
  type Folder,
  type FolderListResponse,
  type PresentationDocument,
} from "#shared";
import { planBootMerge } from "./mergeDocuments";
import { mergeFolders } from "./mergeFolders";
import {
  getLibraryDeck,
  getUserSongs,
  getDeletedSongIds,
  applyServerLibraryDecks,
  applyServerDeckFields,
  dropDeletedLibraryDeck,
  resumeSongDeletes,
} from "../../features/editor/songLibraryStore";
import { mergeLibraryDecks } from "./mergeLibraryDecks";
import { sharedPresentationListener } from "./sharedPresentationListener";
import { ownPresentationListener } from "./ownPresentationListener";
import {
  pullPresentations,
  rememberServerDocuments,
  setOwnPresentationListener,
  setSharedPresentationListener,
  pullDecks,
  pullFolders,
  syncFailureReasonOf,
} from "./presentationSync";
import {
  isRetryableApiError,
  isTransientServerError,
  requestIdOfError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "../api/request";
import {
  BackoffTracker,
  BASE_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  SLOW_RETRY_MS,
  type SyncRetryMode,
} from "./backoff";
import {
  setFolderSyncEnabled,
  setServerFolderListener,
  setFolderGoneListener,
  setFailedFolderResolver,
  pushFolderNow,
  hasPendingFolderPush,
  holdFailedFolderPush,
  isFolderPushPending,
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
  flushDocumentPushes,
  hasPendingDocumentPush,
  isDocumentQueued,
  scheduleDocumentPush,
  setSyncEnabled,
} from "./syncScheduler";
import {
  setDeckSyncEnabled,
  setServerDeckListener,
  setDeckGoneListener,
  setFailedDeckResolver,
  pushDeckNow,
  hasPendingDeckSync,
  holdFailedDeckPush,
  scheduleDeckPush,
  cancelDeckPush,
  isDeckDeletedError,
} from "./deckSync";
import { refreshBackgroundCatalog } from "./backgroundSync";
import {
  isProjecting,
  isProjectionPath,
} from "../../features/presentation/fullscreen";
import {
  getCurrentUserId,
  requestSessionCheck,
  revalidateSession,
} from "../auth/sessionStore";
import { announcePull } from "../storage/storageChannel";

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
 * 초록색 '자동 저장됨'으로 남는다.
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
 * 통과시킨다. 확인하지 않으면 받기·올리기가 401로 실패한 뒤에야 세션을 확인하고, 그동안 받기
 * 단계는 거절돼 포기한다. 확인을 기다렸다가 부팅하지 않는 것은 그동안 큐가 꺼져 있어 지운 곡을
 * 잃기 때문이다.
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
 * 내리는 일은 모두 그 부팅의 세대일 때만 한다. 다시 부팅해 밀려난 부팅이 늦게 끝나며 새
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
 * 세션이 거절돼(401) 올리지 못한 항목도 버리지 않고 큐에 넘긴다. 큐는 재시도 한도 안에서 다시
 * 보내고, 그사이 세션 확인이 로그인 만료를 확인하면 새로고침한 로그인 화면으로 간다.
 * 송출 화면에 있는 동안에는 다시 받지 않고 송출을 마친 뒤로 미룬다. 송출 중에는
 * API·데이터 요청이 0건이어야 하고, 받은 결과를 병합하면 띄운 문서가 바뀔 수 있다.
 * 부팅 도중에 송출을 시작해도 같다. 받기마다 그 직전과 받은 직후에 송출 중이면 그 단계를
 * 받은 결과와 함께 내려놓고, 송출을 마친 뒤 처음부터 다시 받는다. 송출 화면은 지금 띄운
 * 프레젠테이션의 변경을 따라 그리므로, 그대로 병합하면 송출 중인 화면이 바뀌고 다음 요청이
 * 나간다. 병합을 마친 단계가 올리던 폴더·곡도 송출을 시작하면 남은 것은 보내지 않고 도메인 큐에
 * 넘기고, 큐가 송출을 마친 뒤에 올린다. 프레젠테이션도 큐가 송출을 마친 뒤에 올린다.
 *
 * 프레젠테이션은 프레젠테이션 큐로 올리고(`scheduleDocumentPush`) 큐가 모두 보낼 때까지
 * 기다린다(`flushDocumentPushes`). 부팅이 따로 보내면 같은 세트의 PATCH가 큐의 것과 겹쳐 먼저 보낸
 * 판이 나중에 닿을 수 있고, 영구 삭제가 기다리는 큐 비우기가 부팅 push를 기다리지 않는다. 큐는
 * 보낼 때 스토어의 지금 판을 올린다(`ownPresentationListener`). 부팅은 올리기 전에 '동기화 중'으로
 * 두고, 큐가 끝난 뒤에도 그대로일 때만 '동기화됨'으로 바꾼다. 받지 못해 다시 받은 단계는 앞서 남긴
 * '오프라인'을 풀어야 하고, 큐가 그동안 남긴 오프라인·세션 만료·실패를 덮으면 올라가지 않은 변경이
 * 저장된 것처럼 보인다.
 *
 * 폴더는 부모부터 올리고, 부모가 아직 폴더 큐에 남아 있으면(일시 장애로 넘겼거나 다시 시도 중)
 * 자식은 올리지 않고 큐에 넘긴다. 서버는 모르는 부모를 가리키는 폴더를 루트로 옮겨 받고, 이
 * 기기도 응답을 받자마자 그 위치를 따른다. 담긴 폴더가 큐에 남은 세트는 프레젠테이션 큐가 폴더가 오를
 * 때까지 붙잡아 둔다. 부팅이 폴더 큐를 직접 비우지 않는 것은, 비우면 서버가 준 대기를 어기고 다시
 * 시도를 기다리는 폴더를 곧바로 다시 보내며, 그 재시도를 기다리면 보관함 받기가 그만큼 늦기
 * 때문이다. 다만 담긴 폴더가 다시 시도 없이 큐에서 기다리는 세트(방금 고친 폴더)는 폴더 큐를 지금
 * 돌리고 그 큐가 끝날 때까지 기다리므로(`ensureFolderPushed`), 부팅도 그 큐를 기다린다. 그 큐는 다시
 * 시도를 기다리던 다른 폴더도 함께 보낸다.
 *
 * 올린 폴더를 다른 곳에서 영구 삭제했으면(410) 이 기기에서 지우고 곧바로 내 데이터를 다시
 * 받는다(`refreshOwnDataIfStale`). 서버는 그 폴더의 하위 트리도 함께 지웠다. 폴더만 지우면 그 안의
 * 폴더·세트가 없는 부모를 가리켜 드라이브 루트에 휴지통 밖 항목으로 나타난다. 다시 받기는 영구 삭제
 * 기록을 따라 서버와 맞춘 하위 항목만 지운다. 고친 세트는 남아 그 push가 410을 받고 편집을 사본으로
 * 남기고, 다른 곳에서 옮겨 둔 항목은 서버 위치를 받는다.
 *
 * 폴더·곡은 항목마다 올리기 직전과 큐에 넘기거나 실패로 남길 때 지금 저장소에 있는 것을 다시
 * 찾아 쓰고, 그사이 지워졌으면 건너뛴다. 부팅 병합 때의 사본을 올리면 앞 항목을 올리는 동안
 * 사용자가 지운 곡이 되살아나고, 바로 올리기는 큐에 대기 중인 같은 항목을 버리므로 그사이
 * 고친 내용(폴더 이름 등)이 다음 부팅까지 서버에 가지 않는다. 올리는 동안 지운 항목의 실패를
 * 남기면 '다시 시도'가 다시 올릴 항목이 없어 그 실패가 세션 내내 남는다. '다시 시도'도 실패로
 * 남긴 사본 대신 지금 저장소의 폴더·곡을 올린다(`setFailedFolderResolver`,
 * `setFailedDeckResolver`).
 *
 * 병합 결과는 각 스토어의 저장 줄로 저장한다 (`applyServerDocuments` 등). 병합하자마자 기다림
 * 없이 지운 항목과 서버 사본이 이긴 항목의 대기 중인 push를 버린다. 대기 중인 사본은 방금
 * 서버와 견준 메모리보다 새로울 수 없으므로, 남겨 두면 연결이 돌아올 때 지운 항목을 서버에서
 * 되살리거나 서버의 새 사본을 옛 사본으로 덮는다. 지운 곡은 서버의 삭제 기록과 이 페이지에서
 * 지운 곡, 앞선 페이지에서 지우고 서버에서 아직 지우지 못한 곡을 모두 병합에서 뺀다. 앞선
 * 페이지의 삭제는 곡 큐를 켜자마자 기다림 없이 다시 넣어, 목록을 받지 못한 부팅에서도 큐의
 * 백오프로 다시 보낸다. 받기 전부터 알던 폴더·프레젠테이션·곡이 받는 사이 사라졌으면(비우기, 다른
 * 탭의 삭제) 서버 목록에 있어도 다시 넣지 않는다. 목록이 그 삭제보다 먼저 받은 것일 수 있다.
 *
 * 곡 목록까지 병합하면 첫 받기를 마친 것이다. 그때부터 열려 있는 탭의 다시 받기
 * (`refreshOwnDataIfStale`)가 받은 지 얼마나 됐는지 세고, 같은 브라우저의 다른 탭에도 받았다고
 * 알린다.
 *
 * 받은 폴더·프레젠테이션·보관함 목록에 다른 계정의 항목(이 계정의 것도 이 계정에 공유된 것도 아닌
 * 항목)이 있으면 쿠키가 다른 계정의 것이다. 그 단계를 받은 결과와 함께 버리고 '다시 시도'로만 다시
 * 받으며, 세션을 확인한다(`requestSessionCheck`). 다른 탭의 로그인 변화를 듣지 못한 탭(알림 채널이
 * 없는 브라우저, 놓친 알림)의 받기는 401·403 없이 그 계정의 목록을 받는다. 병합하면 그 계정의 비공개
 * 세트가 이 계정의 드라이브에 들어가 저장되고, 서버 목록에 없는 이 계정의 항목을 그 쿠키로 다시
 * 올린다. 세션 확인이 다른 계정을 찾으면 새로고침한다.
 *
 * 결과는 폴더·프레젠테이션·곡 도메인별로 따로 남기고, 올리지 못한 항목은 항목별
 * 실패로 남긴다. 도메인 단계만 바꾸면 같은 도메인 큐의 다음 성공이 그 실패를 덮는다.
 * 도메인 큐가 아직 끝내지 못한 일(보내는 중이거나 다시 시도할 것)이 있으면 그 결과는
 * 큐가 남긴다. 부팅의 '동기화됨'은 아직 올라가지 않은 변경을 가리고, 큐가 이미 다시
 * 올린 항목을 두고 남긴 '오프라인'은 지울 주체가 없어 세션 내내 남는다.
 * 상태 초기화는 큐를 켜기 전에 한다. 켠 뒤에 지우면 먼저 실패한 큐의 기록이 사라진다.
 * 다시 부르거나 동기화를 끄면(`stopSync`) 앞선 부팅의 남은 단계는 상태를 남기지 않는다.
 */
export async function runBootSync(): Promise<void> {
  bootGeneration += 1;
  const generation = bootGeneration;
  syncStopped = false;
  bootPulled = false;
  markBootPullPending(generation);
  cancelBootRetry();
  resetSyncStatus();
  setSyncStatus("folder", "syncing");
  setSyncStatus("presentation", "syncing");
  setSyncStatus("deck", "syncing");
  setSharedPresentationListener(sharedPresentationListener);
  setOwnPresentationListener(ownPresentationListener);
  setSyncEnabled(true);
  setDeckSyncEnabled(true);
  resumeSongDeletes();
  setServerDeckListener(applyServerDeckFields);
  setDeckGoneListener(dropDeletedLibraryDeck);
  setFailedDeckResolver(getLibraryDeck);
  setFolderSyncEnabled(true);
  setServerFolderListener(applyServerFolder);
  setFolderGoneListener(removeGoneFolders);
  setFailedFolderResolver(getFolder);
  void refreshBackgroundCatalog();

  try {
    await syncDriveAndDecks();
  } finally {
    clearBootPull("folder", generation);
    clearBootPull("presentation", generation);
  }
}

/**
 * 이 탭의 계정이 끝날 때(로그아웃·세션 만료·다른 계정) 부팅 동기화가 켠 것을 모두 끈다. 세 큐를
 * 끄고, 앞선 부팅의 남은 단계와 다시 받기, 송출을 마친 뒤로 미뤄 둔 부팅, 첫 받기 표시를 버리고,
 * 서버 응답을 받던 리스너를 뗀다. 열려 있는 탭의 다시 받기(`refreshOwnDataIfStale`)도 멈추고,
 * 받는 중이던 결과는 버린다.
 *
 * 동기화를 끄는 길은 이것 하나다. 계정이 끝나면 페이지를 새로고침하므로 같은 페이지에서 큐를 다시
 * 켜는 일은 없다. 새로고침을 기다리는 동안(송출 중이면 송출을 마칠 때까지) 앞 계정의 항목이나 앞선
 * 부팅의 다음 단계가 다른 계정의 쿠키로 나가면 안 된다. `runBootSync`에 등록을 더하면 여기서도
 * 풀어야 한다.
 */
export function stopSync(): void {
  bootGeneration += 1;
  syncStopped = true;
  cancelBootRetry();
  deferredBootUserId = null;
  pendingBootPulls.clear();
  clearBootPullTimer();
  notifyBootPull();
  setSharedPresentationListener(null);
  setOwnPresentationListener(null);
  setServerDeckListener(null);
  setDeckGoneListener(null);
  setFailedDeckResolver(null);
  setServerFolderListener(null);
  setFolderGoneListener(null);
  setFailedFolderResolver(null);
  setFolderSyncEnabled(false);
  setSyncEnabled(false);
  setDeckSyncEnabled(false);
}

let bootGeneration = 0;
let syncStopped = false;
let bootPulled = false;
let lastPulledAt = 0;
let refreshInFlight: Promise<void> | null = null;

function idsOf(items: readonly { id: string }[]): Set<string> {
  return new Set(items.map((item) => item.id));
}

function removeGoneFolders(ids: readonly string[]): Promise<void> {
  const removing = removeFoldersLocally(ids);
  void refreshOwnDataIfStale("manual");
  return removing;
}

async function syncDriveAndDecks(): Promise<void> {
  const generation = bootGeneration;
  if (parkWhileProjecting(syncDriveAndDecks)) return;
  const userId = getCurrentUserId();
  const knownBeforePull = idsOf(listPresentations());
  const knownFolders = idsOf(getFolders());
  let serverDocuments;
  let tombstones: DriveTombstones;
  let unsynced: readonly SyncDomain[] = ["folder", "presentation", "deck"];
  try {
    const folderList = await pullFolders();
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncDriveAndDecks)) return;
    if (holdsOtherAccount(userId, [folderList.folders])) {
      dropOtherAccountsPull(syncDriveAndDecks, unsynced);
      return;
    }
    tombstones = folderList.tombstones;
    const folderStatus = await syncFolders(
      folderList.folders,
      tombstones,
      knownFolders,
      generation,
    );
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncDriveAndDecks)) return;
    settleSyncStatus("folder", folderStatus);
    unsynced = ["presentation", "deck"];
    serverDocuments = await pullPresentations();
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncDriveAndDecks)) return;
    if (holdsOtherAccount(userId, [serverDocuments])) {
      dropOtherAccountsPull(syncDriveAndDecks, unsynced);
      return;
    }
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

  setSyncStatus("presentation", "syncing");
  for (const id of needsPush) {
    const latest = getPresentationById(id);
    if (latest) scheduleDocumentPush(latest);
  }
  await flushDocumentPushes();
  if (generation !== bootGeneration) return;
  if (getSyncDomainStatus("presentation") === "syncing") {
    settleSyncStatus("presentation", "synced");
  }

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

function abandonPull(step: () => Promise<void>): SyncStatus {
  retryBackoff.reset();
  abandonedStep = step;
  return "error";
}

interface AccountRecord {
  userId?: unknown;
  access?: { memberId?: unknown };
}

function belongsToOtherAccount(record: AccountRecord, userId: string): boolean {
  return (
    typeof record.userId === "string" &&
    record.userId !== userId &&
    record.access?.memberId !== userId
  );
}

function holdsOtherAccount(
  userId: string | null,
  lists: readonly (readonly AccountRecord[])[],
): boolean {
  return (
    userId !== null &&
    lists.some((list) =>
      list.some((record) => belongsToOtherAccount(record, userId)),
    )
  );
}

function dropOtherAccountsPull(
  step: () => Promise<void>,
  domains: readonly SyncDomain[],
): void {
  const status = abandonPull(step);
  for (const domain of domains) setSyncStatus(domain, status);
  requestSessionCheck();
}

function retryPullAfter(
  step: () => Promise<void>,
  delay: number,
  waitsOnServer: boolean,
): void {
  abandonedStep = null;
  retryStep = step;
  retryWaitsOnServer = waitsOnServer;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(runRetry, delay);
}

function retryPullLater(step: () => Promise<void>, err: unknown): SyncStatus {
  if (!isRetryableApiError(err)) return abandonPull(step);
  const timedOut = err instanceof TimeoutError;
  const waitsOnServer = timedOut || !(err instanceof OfflineError);
  if (waitsOnServer && retryBackoff.getServerAttempt() >= MAX_RETRY_ATTEMPTS) {
    if (!isTransientServerError(err)) return abandonPull(step);
    retryPullAfter(step, SLOW_RETRY_MS, true);
    return "error";
  }
  const delay = retryBackoff.getDelay(err);
  if (timedOut) retryBackoff.countServerAttempt();
  retryPullAfter(step, delay, waitsOnServer);
  return "offline";
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
 * `wake`는 서버가 거절해(5xx·429) 기다리거나 받다 시간을 넘겨 기다리는 단계를 앞당기지 않고
 * 백오프 횟수도 그대로 둔다. 포커스마다 목록 전체를 다시 받으면 장애 중인 서버를 더 누른다.
 *
 * 받다 시간을 넘기면 서버가 거절한 것처럼 재시도 한도에 센다. 느린 회선에서 큰 목록은 매번 처음부터
 * 다시 받으므로, 끝나지 않는 받기를 한도 없이 되풀이하면 기록 전체를 1분마다 다시 읽는다. 한도에
 * 이르면 포기하고 `manual`만 다시 받는다. 서버가 지금은 받지 못한다고 답한 거절(408·429·502·503·504,
 * `isTransientServerError`)은 한도를 넘겨도 포기하지 않고 `SLOW_RETRY_MS`마다 다시 받는다. 장애가
 * 끝나면 '다시 시도'를 누르지 않아도 부팅 병합을 마쳐, 이 기기에만 있는 변경을 올리고 다른 기기에서
 * 고친 판을 받는다. 500처럼 다시 받아도 같은 답일 거절은 한도에서 포기한다. `manual`은 거절돼
 * 포기한 단계도 다시 받는다.
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
  knownBeforePull: ReadonlySet<string>,
  generation: number,
): Promise<SyncStatus> {
  const deletedIds = new Set(tombstones.folderIds);
  const local = getFolders();
  const { folders, needsPush } = mergeFolders(
    local.filter((folder) => !deletedIds.has(folder.id)),
    serverFolders,
    { knownBeforePull },
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
      waitsFor: (folder) =>
        folder.parentId !== null && isFolderPushPending(folder.parentId),
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
  const userId = getCurrentUserId();
  const knownBeforePull = idsOf(getUserSongs());
  let pull;
  try {
    pull = await pullDecks();
    if (generation !== bootGeneration) return;
    if (parkWhileProjecting(syncLibraryDecks)) return;
    if (holdsOtherAccount(userId, [pull.decks])) {
      dropOtherAccountsPull(syncLibraryDecks, ["deck"]);
      return;
    }
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
    { deletedIds, knownBeforePull },
  );
  for (const id of deletedIds) cancelDeckPush(id);
  cancelPushesOfServerWins(decks, needsPush, cancelDeckPush);
  await applyServerLibraryDecks(decks, removedIds);
  if (generation !== bootGeneration) return;
  bootPulled = true;
  lastPulledAt = Date.now();
  announcePull();

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
  waitsFor?: (item: T) => boolean;
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
    if (isProjecting() || target.waitsFor?.(item)) {
      target.requeue(item);
      offline = true;
      continue;
    }
    try {
      await target.push(item);
    } catch (err) {
      if (generation !== bootGeneration) break;
      const expired = err instanceof SessionExpiredError;
      if (expired || isRetryableApiError(err)) {
        if (expired) sessionExpired = true;
        else offline = true;
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

/**
 * 열려 있는 탭이 내 데이터를 다시 받는 최소 간격. 창으로 돌아올 때, 주소를 옮길 때, 5분마다 하는
 * 확인(`wake`)은 받은 지 이만큼 지나야 다시 받는다. 다시 받기는 내 폴더, 곡을 모두 담은 프레젠테이션
 * 전부, 보관함을 통째로 받는 무거운 요청이다.
 */
export const FRESHNESS_MS = 60_000;

/**
 * 연결이 돌아왔을 때(`reconnect`) 다시 받는 최소 간격. `online`은 핫스폿이 끊겼다 붙을 때마다 와서,
 * 막지 않으면 흔들리는 Wi‑Fi에서 같은 목록을 쉬지 않고 받는다.
 */
export const RECONNECT_REFRESH_MS = 15_000;

function canRefresh(mode: SyncRetryMode): boolean {
  if (syncStopped || retryStep || isProjecting()) return false;
  if (!bootPulled && !abandonedStep) return false;
  if (mode === "manual") return true;
  const interval = mode === "reconnect" ? RECONNECT_REFRESH_MS : FRESHNESS_MS;
  const elapsed = Date.now() - lastPulledAt;
  return elapsed < 0 || elapsed >= interval;
}

/**
 * 열려 있는 탭이 내 폴더·프레젠테이션·보관함 곡을 서버에서 다시 받는다. 부팅 때만 받으면 며칠 열어 둔
 * 교회 PC의 탭이 지난 판을 띄우고 송출하며, 그 위에서 고친 내용이 다른 기기의 편집을 덮는다.
 *
 * 받기만 한다(`refresh` 병합). 프레젠테이션은 서버와 맞춘 판이고 이 탭이 올리기를 기다리지 않으며
 * 저장본과 같은 세트만 서버 판이 더 새로울 때 받는다. 고친 세트와 이전 저장본은 그대로 둔다. 폴더·곡은
 * 부팅처럼 더 늦게 고친 쪽을 고르되 올리지 않고, 서버 사본을 받은 항목의 대기 중인 push만 버린다. 그
 * push는 서버가 옛 수정으로 보고 버릴 사본이다. 영구 삭제 기록과 지운 곡을 따르고, 받기 전부터 알던
 * 항목이 받는 사이 사라졌으면(비우기, 다른 탭의 삭제) 다시 넣지 않는다. 동기화 상태는 바꾸지 않고,
 * 받지 못하면 조용히 넘어가 다음 신호에 다시 받는다. 받은 결과를 반영하면 같은 브라우저의 다른 탭에
 * 받았다고 알린다.
 *
 * 한 번에 하나만 받는다. 창으로 돌아오기·주소 이동·5분마다 확인(`wake`)은 받은 지 `FRESHNESS_MS`,
 * 연결 회복(`reconnect`)은 `RECONNECT_REFRESH_MS`가 지나야 받고, '다시 시도'(`manual`)는 곧바로
 * 받는다. 받기 시작한 때부터 세어, 받지 못해도 그 간격 안에는 장애 중인 서버에 다시 묻지 않는다. 다른
 * 탭이 받았다고 알리면 그때부터 센다(`noteRemotePull`). 기기 시계가 뒤로 돌아가 받은 때가 앞날이 되면
 * 오래된 것으로 본다. 시계를 맞춘 만큼 다시 받지 않으면 그동안 지난 판을 띄운다. 같은 브라우저의 다른
 * 탭이 받는 중이면(Web Lock `chiton:refresh`) 함께 받지 않고 그 탭의 받았다는 알림을 기다린다. 받았다는
 * 알림만으로는 다른 탭이 받기를 마친 뒤에야 알게 되어, 연결이 돌아온 순간처럼 여러 탭이 한꺼번에 신호를
 * 받으면 모두 목록 전체를 받는다.
 *
 * 부팅 동기화가 첫 받기를 마치기 전(송출 화면에서 부팅해 미뤄 둔 부팅도), 받지 못한 부팅 단계가 다시
 * 받기를 기다리는 동안, 동기화를 끈 뒤(`stopSync`), 송출 중에는 받지 않는다. 그동안은 부팅 병합과 그
 * 재시도가 서버와 맞추고, 송출 중에는 요청이 0건이어야 한다. 부팅이 거절돼 받기를 포기했으면 '다시
 * 시도'만 그 단계를 다시 받으므로, 그때부터는 이 다시 받기가 맞춘다. 받는 사이 송출을 시작했거나
 * 계정·부팅이 바뀌었으면 받은 것을 버린다. 송출 중인 프레젠테이션이 바뀌면 안 된다. 받은 목록에 다른
 * 계정의 항목이 있으면 받은 것을 모두 버리고 세션을 확인한다(`runBootSync`와 같은 까닭).
 */
export function refreshOwnDataIfStale(mode: SyncRetryMode): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  const userId = getCurrentUserId();
  if (!userId || !canRefresh(mode)) return Promise.resolve();
  lastPulledAt = Date.now();
  const generation = bootGeneration;
  const running = withRefreshLock(() =>
    refreshOwnData(userId, generation),
  ).finally(() => {
    if (refreshInFlight === running) refreshInFlight = null;
  });
  refreshInFlight = running;
  return running;
}

const REFRESH_LOCK = "chiton:refresh";

async function withRefreshLock(task: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return task();
  await locks.request(REFRESH_LOCK, { ifAvailable: true }, async (lock) => {
    if (lock) await task();
  });
}

/**
 * 같은 브라우저의 다른 탭이 서버에서 내 데이터를 방금 받았다(`storageSync`가 `pulled` 알림을 받아
 * 부른다). 이 탭은 다시 받는 간격을 그때부터 센다. 그 탭이 받아 바꾼 저장본은 저장본 알림으로 이 탭에도
 * 오므로, 탭마다 같은 목록을 다시 받으면 요청만 는다.
 */
export function noteRemotePull(): void {
  lastPulledAt = Date.now();
}

async function refreshOwnData(
  userId: string,
  generation: number,
): Promise<void> {
  const knownFolders = idsOf(getFolders());
  const knownPresentations = idsOf(listPresentations());
  const knownSongs = idsOf(getUserSongs());
  let folderList: FolderListResponse;
  let serverDocuments: PresentationDocument[];
  let library: Awaited<ReturnType<typeof pullDecks>>;
  try {
    [folderList, serverDocuments, library] = await Promise.all([
      pullFolders(),
      pullPresentations(),
      pullDecks(),
    ]);
  } catch {
    return;
  }
  if (
    generation !== bootGeneration ||
    isProjecting() ||
    getCurrentUserId() !== userId
  ) {
    return;
  }
  if (
    holdsOtherAccount(userId, [
      folderList.folders,
      serverDocuments,
      library.decks,
    ])
  ) {
    requestSessionCheck();
    return;
  }

  const folders = refreshFolders(folderList, knownFolders);
  refreshPresentations(
    serverDocuments,
    folderList.tombstones.presentationIds,
    knownPresentations,
  );
  const songs = refreshLibraryDecks(library, knownSongs);
  await Promise.all([folders, songs]);
  if (generation === bootGeneration) announcePull();
}

function cancelPushesOfServerCopies<T extends { id: string }>(
  local: readonly T[],
  server: readonly T[],
  merged: readonly T[],
  cancel: (id: string) => void,
): void {
  const localIds = idsOf(local);
  const serverCopies = new Set<T>(server);
  for (const item of merged) {
    if (localIds.has(item.id) && serverCopies.has(item)) cancel(item.id);
  }
}

function refreshFolders(
  folderList: FolderListResponse,
  knownBeforePull: ReadonlySet<string>,
): Promise<void> {
  const deletedIds = new Set(folderList.tombstones.folderIds);
  const local = getFolders();
  const kept = local.filter((folder) => !deletedIds.has(folder.id));
  const { folders } = mergeFolders(kept, folderList.folders, {
    mode: "refresh",
    knownBeforePull,
  });
  cancelPushesOfServerCopies(
    kept,
    folderList.folders,
    folders,
    cancelFolderPush,
  );
  return applyServerFolders(
    folders,
    local.filter((folder) => deletedIds.has(folder.id)).map((f) => f.id),
  );
}

function refreshPresentations(
  serverDocuments: PresentationDocument[],
  deletedIds: readonly string[],
  knownBeforePull: ReadonlySet<string>,
): void {
  const { documents, removedIds } = planBootMerge(
    listPresentations(),
    serverDocuments,
    deletedIds,
    knownBeforePull,
    {
      mode: "refresh",
      isQueued: (id) => isDocumentQueued(id) || mayDifferFromStorage(id),
    },
  );
  rememberServerDocuments(serverDocuments);
  applyServerDocuments(documents, removedIds);
}

function refreshLibraryDecks(
  library: Awaited<ReturnType<typeof pullDecks>>,
  knownBeforePull: ReadonlySet<string>,
): Promise<void> {
  const deletedIds = new Set([...library.deletedIds, ...getDeletedSongIds()]);
  const local = getUserSongs();
  const { decks, removedIds } = mergeLibraryDecks(local, library.decks, {
    deletedIds,
    mode: "refresh",
    knownBeforePull,
  });
  for (const id of deletedIds) cancelDeckPush(id);
  cancelPushesOfServerCopies(local, library.decks, decks, cancelDeckPush);
  return applyServerLibraryDecks(decks, removedIds);
}

export function __resetBootSyncForTests(): void {
  cancelBootRetry();
  deferredBootUserId = null;
  pendingBootPulls.clear();
  clearBootPullTimer();
  notifyBootPull();
  syncStopped = false;
  bootPulled = false;
  lastPulledAt = 0;
  refreshInFlight = null;
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
