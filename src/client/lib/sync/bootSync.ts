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
  holdFailedDocumentPush,
  scheduleDocumentPush,
  setSyncEnabled,
} from "./syncScheduler";
import {
  setDeckSyncEnabled,
  setServerDeckListener,
  pushDeckNow,
  hasPendingDeckSync,
  holdFailedDeckPush,
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
 * 백오프 간격과 연결 회복(`retryBootSyncIfNeeded`)으로 다시 받고, 올리지 못한 항목은
 * 도메인 큐에 넘겨 큐의 백오프로 다시 올린다. 다시 하지 않으면 그 도메인이 세션 내내
 * '오프라인'으로 남아, 연결이 돌아와 저장이 다 끝나도 헤더가 초록색으로 돌아오지 않는다.
 * 송출 화면에 있는 동안에는 다시 받지 않고 송출을 마친 뒤로 미룬다. 송출 중에는
 * API·데이터 요청이 0건이어야 하고, 받은 결과를 병합하면 띄운 문서가 바뀔 수 있다.
 *
 * 항목마다 올리기 직전과 큐에 넘길 때 지금 저장소에 있는 것을 다시 찾아 쓰고, 그사이
 * 지워졌으면 건너뛴다. 부팅 병합 때의 사본을 올리면 앞 항목을 올리는 동안 사용자가 지운
 * 곡이 되살아나고, 바로 올리기는 큐에 대기 중인 같은 항목을 버리므로 그사이 고친 내용
 * (폴더 이름 등)이 다음 부팅까지 서버에 가지 않는다.
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

  const deckStatus = await pushLatestEach(
    {
      domain: "deck",
      current: getUserSongs,
      push: pushDeckNow,
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
        if (latest) target.hold(latest);
        recordSyncFailure({
          id: item.id,
          title: target.titleOf(item),
          kind: target.domain,
          status: err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
          requestId: requestIdOfError(err),
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
