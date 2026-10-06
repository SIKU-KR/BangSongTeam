import {
  listPresentations,
  applyServerDocuments,
  removePersistedPresentation,
} from "../../features/presentation";
import {
  getFolders,
  applyServerFolders,
  applyServerFolder,
} from "../../features/drive/folderStore";
import {
  sortFoldersParentFirst,
  type DriveTombstones,
  type Folder,
} from "#shared";
import { savePresentation } from "../storage";
import { planBootMerge } from "./mergeDocuments";
import { mergeFolders } from "./mergeFolders";
import {
  getUserSongs,
  applyServerLibraryDecks,
  applyServerDeckFields,
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
} from "./presentationSync";
import {
  isRetryableApiError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import { BackoffTracker, BASE_BACKOFF_MS, MAX_RETRY_ATTEMPTS } from "./backoff";
import {
  setFolderSyncEnabled,
  setServerFolderListener,
  pushFolderNow,
  hasPendingFolderPush,
  scheduleFolderPush,
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
  hasPendingDocumentPush,
  scheduleDocumentPush,
  setSyncEnabled,
} from "./syncScheduler";
import {
  setDeckSyncEnabled,
  setServerDeckListener,
  pushDeckNow,
  hasPendingDeckSync,
  scheduleDeckPush,
} from "./deckSync";
import { refreshBackgroundCatalog } from "./backgroundSync";
import { isProjectionPath } from "../../features/presentation/fullscreen";

/**
 * 송출 중 새로고침하면 부팅 경로를 처음부터 다시 탄다. 여기서 서버와 맞추면
 * 송출 중 API·데이터 요청 0건이 깨지므로, 송출 화면에서는 부팅 동기화를 돌리지 않는다.
 */
export function shouldRunBootSync(pathname: string): boolean {
  return !isProjectionPath(pathname);
}

/**
 * 부팅 시 서버와 한 번 맞춘다.
 *
 * **백그라운드로 돌린다.** 로컬 하이드레이션이 끝나면 곧바로 화면을 그리고,
 * 서버 병합은 그 뒤에 붙인다. 서버를 기다리느라 첫 화면이 늦어지면 네트워크가
 * 느린 교회에서 예배 시작이 그만큼 밀린다.
 *
 * 오프라인은 조용히 넘어간다 — 실패가 아니라 정상 경로다. 다만 받지 못한 단계는
 * 백오프 간격과 `online` 이벤트로 다시 받고, 올리지 못한 항목은 도메인 큐에 넘겨
 * 큐의 백오프로 다시 올린다. 다시 하지 않으면 그 도메인이 세션 내내 '오프라인'으로
 * 남아, 연결이 돌아와 저장이 다 끝나도 헤더가 초록색으로 돌아오지 않는다.
 * 송출 화면에 있는 동안에는 다시 받지 않고 송출을 마친 뒤로 미룬다. 송출 중에는
 * API·데이터 요청이 0건이어야 하고, 받은 결과를 병합하면 띄운 문서가 바뀔 수 있다.
 *
 * 큐에 넘길 때는 부팅 병합 때의 사본이 아니라 지금 저장소에 있는 것을 넘긴다. 부팅이
 * 올리는 동안 사용자가 고치거나 지운 것을 옛 사본이 덮으면 그 변경이 서버에 가지 않는다.
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
  cancelBootRetry();
  resetSyncStatus();
  setSyncStatus("folder", "syncing");
  setSyncStatus("presentation", "syncing");
  setSyncStatus("deck", "syncing");
  setSharedPresentationListener(sharedPresentationListener);
  setSyncEnabled(true);
  setDeckSyncEnabled(true);
  setServerDeckListener(applyServerDeckFields);
  setFolderSyncEnabled(true);
  setServerFolderListener(applyServerFolder);
  void refreshBackgroundCatalog();

  await syncDriveAndDecks();
}

let bootGeneration = 0;

async function syncDriveAndDecks(): Promise<void> {
  const generation = bootGeneration;
  const knownBeforePull = new Set(listPresentations().map((doc) => doc.id));
  let serverDocuments;
  let tombstones: DriveTombstones;
  let unsynced: readonly SyncDomain[] = ["folder", "presentation", "deck"];
  try {
    const folderList = await pullFolders();
    if (generation !== bootGeneration) return;
    tombstones = folderList.tombstones;
    const folderStatus = await syncFolders(
      folderList.folders,
      tombstones,
      generation,
    );
    if (generation !== bootGeneration) return;
    settleSyncStatus("folder", folderStatus);
    unsynced = ["presentation", "deck"];
    serverDocuments = await pullPresentations();
    if (generation !== bootGeneration) return;
    rememberServerDocuments(serverDocuments);
    retryBackoff.reset();
  } catch (err) {
    if (generation !== bootGeneration) return;
    const status = retryPullLater(syncDriveAndDecks, err);
    for (const domain of unsynced) setSyncStatus(domain, status);
    return;
  }

  const { documents, needsPush, removedIds } = planBootMerge(
    listPresentations(),
    serverDocuments,
    tombstones.presentationIds,
    knownBeforePull,
  );

  applyServerDocuments(documents);
  for (const id of removedIds) {
    await removePersistedPresentation(id);
  }

  for (const document of documents) {
    try {
      await savePresentation(document);
    } catch (error) {
      void error;
    }
  }

  const presentationStatus = await pushEachTrackingStatus(
    "presentation",
    findEach(documents, needsPush),
    pushPresentation,
    requeueLatest(listPresentations, scheduleDocumentPush),
    (document) => document.title,
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

function requeueLatest<T extends { id: string }>(
  current: () => readonly T[],
  schedule: (item: T) => void,
): (item: T) => void {
  return (item) => {
    const latest = current().find((candidate) => candidate.id === item.id);
    if (latest) schedule(latest);
  };
}

const retryBackoff = new BackoffTracker();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep: (() => Promise<void>) | null = null;
let onlineListenerRegistered = false;

function cancelBootRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryStep = null;
  retryBackoff.reset();
}

function retryPullLater(step: () => Promise<void>, err: unknown): SyncStatus {
  if (
    !isRetryableApiError(err) ||
    (!(err instanceof OfflineError) &&
      retryBackoff.getServerAttempt() >= MAX_RETRY_ATTEMPTS)
  ) {
    retryBackoff.reset();
    return "error";
  }
  retryStep = step;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(runRetry, retryBackoff.getDelay(err));
  registerOnlineListener();
  return "offline";
}

function isProjecting(): boolean {
  return (
    typeof window !== "undefined" && isProjectionPath(window.location.pathname)
  );
}

function runRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (isProjecting()) {
    if (retryStep) retryTimer = setTimeout(runRetry, BASE_BACKOFF_MS);
    return;
  }
  const step = retryStep;
  retryStep = null;
  if (step) void step().catch(() => undefined);
}

function handleOnline(): void {
  if (!retryStep || isProjecting()) return;
  retryBackoff.reset();
  runRetry();
}

function registerOnlineListener(): void {
  if (onlineListenerRegistered || typeof window === "undefined") return;
  onlineListenerRegistered = true;
  window.addEventListener("online", handleOnline);
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
  await applyServerFolders(
    folders,
    local.filter((folder) => deletedIds.has(folder.id)).map((f) => f.id),
  );

  const toPush = new Set(needsPush);
  return pushEachTrackingStatus(
    "folder",
    sortFoldersParentFirst(
      folders.filter((candidate) => toPush.has(candidate.id)),
      folders,
    ),
    pushFolderNow,
    requeueLatest(getFolders, scheduleFolderPush),
    (folder) => folder.name,
    generation,
  );
}

async function syncLibraryDecks(): Promise<void> {
  const generation = bootGeneration;
  let serverDecks;
  try {
    serverDecks = await pullDecks();
    if (generation !== bootGeneration) return;
    retryBackoff.reset();
  } catch (err) {
    if (generation !== bootGeneration) return;
    setSyncStatus("deck", retryPullLater(syncLibraryDecks, err));
    return;
  }

  const { decks, needsPush } = mergeLibraryDecks(getUserSongs(), serverDecks);
  await applyServerLibraryDecks(decks);

  const deckStatus = await pushEachTrackingStatus(
    "deck",
    findEach(decks, needsPush),
    pushDeckNow,
    requeueLatest(getUserSongs, scheduleDeckPush),
    (deck) => deck.title,
    generation,
  );
  if (generation !== bootGeneration) return;
  settleSyncStatus("deck", deckStatus);
}

function findEach<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  return ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is T => item !== undefined);
}

async function pushEachTrackingStatus<T extends { id: string }>(
  domain: SyncDomain,
  items: readonly T[],
  push: (item: T) => Promise<unknown>,
  requeue: (item: T) => void,
  titleOf: (item: T) => string,
  generation: number,
): Promise<SyncStatus> {
  let sessionExpired = false;
  let offline = false;
  for (const item of items) {
    if (generation !== bootGeneration) break;
    try {
      await push(item);
    } catch (err) {
      if (generation !== bootGeneration) break;
      if (err instanceof SessionExpiredError) {
        sessionExpired = true;
      } else if (isRetryableApiError(err)) {
        offline = true;
        requeue(item);
      } else {
        recordSyncFailure({
          id: item.id,
          title: titleOf(item),
          kind: domain,
          status: err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
        });
      }
    }
  }
  if (sessionExpired) return "error";
  return offline ? "offline" : "synced";
}

export function __resetBootSyncForTests(): void {
  cancelBootRetry();
}
