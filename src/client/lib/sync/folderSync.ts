import { sortFoldersParentFirst, type Folder } from "#shared";
import {
  isRetryableApiError,
  requestIdOfError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import { pushFolder, syncFailureReasonOf } from "./presentationSync";
import {
  clearSyncFailure,
  recordSyncFailure,
  setSyncStatus,
  type SyncFailure,
} from "./syncStatus";
import {
  BackoffTracker,
  MAX_RETRY_ATTEMPTS,
  type SyncRetryMode,
} from "./backoff";

const FOLDER_SYNC_DEBOUNCE_MS = 2000;

type FolderPusher = (folder: Folder) => Promise<Folder>;
type ServerFolderListener = (folder: Folder) => void;
type FolderGoneListener = (ids: readonly string[]) => unknown;

let pusher: FolderPusher = pushFolder;
let listener: ServerFolderListener | null = null;
let goneListener: FolderGoneListener | null = null;
let enabled = false;
let pending = new Map<string, Folder>();
let failed = new Map<string, Folder>();
let waitingOnServer = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();
const runningBatches = new Set<Promise<void>>();
const backoff = new BackoffTracker();

/**
 * 로그인·하이드레이션이 끝난 뒤에만 켠다 (송출 화면에서는 켜지 않는다).
 *
 * 꺼져 있는 동안에는 보내는 중인 묶음의 남은 폴더도, 끈 뒤에 끝난 요청이 다시 넣은 폴더도
 * 보내지 않는다. 계정이 끝난 탭(`stopSync`)은 새로고침할 때까지 큐를 꺼 두고, 송출 중이면
 * 송출을 마칠 때까지 새로고침을 미룬다. 그사이 요청이 나가면 다른 계정의 쿠키로 간다.
 */
export function setFolderSyncEnabled(next: boolean): void {
  enabled = next;
  if (!next) clearPending();
}

/** 서버가 확정한 폴더(부모 보정 포함)를 받을 곳을 등록한다 */
export function setServerFolderListener(
  next: ServerFolderListener | null,
): void {
  listener = next;
}

/**
 * 다른 곳에서 영구 삭제한 폴더(올렸더니 410)를 받을 곳을 등록한다. 부팅 동기화가 등록하고
 * `stopSync`가 뗀다.
 *
 * 서버는 영구 삭제한 폴더를 되살리지 않으므로, 이 기기에서도 지워야 다음 편집마다 같은 거절을 받지
 * 않는다. 그 폴더는 실패로 남기지도 다시 올리지도 않는다.
 */
export function setFolderGoneListener(next: FolderGoneListener | null): void {
  goneListener = next;
}

function isFolderGone(err: unknown): boolean {
  return err instanceof ServerRejectedError && err.status === 410;
}

function forgetGoneFolder(id: string): void {
  pending.delete(id);
  failed.delete(id);
  backoff.reset(id);
  clearSyncFailure("folder", id);
  void goneListener?.([id]);
}

function clearPending(): void {
  pending = new Map();
  failed = new Map();
  waitingOnServer = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  backoff.reset();
}

async function pushAll(folders: Folder[]): Promise<void> {
  if (folders.length === 0) return;

  setSyncStatus("folder", "syncing");
  let offline = false;
  let sessionExpired = false;
  let serverRejected = false;
  let minRetryDelay = Infinity;

  for (const folder of sortFoldersParentFirst(folders)) {
    if (!enabled) return;
    try {
      const saved = await pusher(folder);
      listener?.(saved);
      backoff.reset(folder.id);
      failed.delete(folder.id);
      clearSyncFailure("folder", folder.id);
    } catch (err) {
      if (isFolderGone(err)) {
        forgetGoneFolder(folder.id);
        continue;
      }
      const expired = err instanceof SessionExpiredError;
      if (
        err instanceof OfflineError ||
        ((isRetryableApiError(err) || expired) &&
          backoff.getServerAttempt(folder.id) < MAX_RETRY_ATTEMPTS)
      ) {
        if (expired) sessionExpired = true;
        else offline = true;
        if (err instanceof ServerRejectedError || expired) {
          serverRejected = true;
        }
        if (!pending.has(folder.id)) pending.set(folder.id, folder);
        const delay = backoff.getDelay(folder.id, err);
        if (delay < minRetryDelay) minRetryDelay = delay;
      } else {
        pending.delete(folder.id);
        backoff.reset(folder.id);
        failed.set(folder.id, folder);
        const failure: SyncFailure = {
          id: folder.id,
          title: folder.name,
          kind: "folder",
          status: err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
          requestId: requestIdOfError(err),
          reason: syncFailureReasonOf(err),
        };
        console.error("Folder push failed permanently", failure);
        recordSyncFailure(failure);
      }
    }
  }

  const retrying = offline || sessionExpired;
  waitingOnServer = retrying && serverRejected;
  if (sessionExpired) {
    setSyncStatus("folder", "error");
  } else if (offline) {
    setSyncStatus("folder", "offline");
  } else {
    backoff.reset();
    setSyncStatus("folder", "synced");
  }
  if (retrying && !timer && minRetryDelay !== Infinity) {
    timer = setTimeout(run, minRetryDelay);
  }
}

function run(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!enabled || pending.size === 0) return;

  const folders = [...pending.values()];
  pending = new Map();
  const batch = inFlight.then(() => pushAll(folders));
  runningBatches.add(batch);
  inFlight = batch.finally(() => {
    runningBatches.delete(batch);
  });
}

/** 같은 폴더를 연달아 고치면 마지막 것만 올린다 */
export function scheduleFolderPush(folder: Folder): void {
  if (!enabled) return;
  failed.delete(folder.id);
  pending.set(folder.id, folder);
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, FOLDER_SYNC_DEBOUNCE_MS);
}

/** 영구 삭제한 폴더의 대기 중인 push를 취소하고, 남은 실패 기록도 지운다 */
export function cancelFolderPush(id: string): void {
  pending.delete(id);
  failed.delete(id);
  backoff.reset(id);
  clearSyncFailure("folder", id);
}

/**
 * 폴더 1건을 지금 바로 올리고 서버 확정본을 돌려준다 (부팅 동기화).
 * 앞서 나간 같은 폴더의 push가 늦게 도착해 이번 것을 덮지 않도록 줄을 선다.
 * 다른 곳에서 영구 삭제한 폴더면(410) 지웠다고 알리고(`setFolderGoneListener`) `null`이다.
 */
export async function pushFolderNow(folder: Folder): Promise<Folder | null> {
  pending.delete(folder.id);
  backoff.reset(folder.id);
  await inFlight;
  let saved: Folder;
  try {
    saved = await pusher(folder);
  } catch (err) {
    if (!isFolderGone(err)) throw err;
    forgetGoneFolder(folder.id);
    return null;
  }
  listener?.(saved);
  failed.delete(folder.id);
  clearSyncFailure("folder", folder.id);
  return saved;
}

/**
 * 부팅 동기화가 올리다 영구 실패로 남긴 폴더를 맡긴다. 사용자가 '다시 시도'를 누르면
 * (`retryFolderSyncNow("manual")`) 큐가 다시 올린다.
 */
export function holdFailedFolderPush(folder: Folder): void {
  failed.set(folder.id, folder);
}

/** 큐가 아직 끝내지 못한 폴더가 있는지 (보내는 중이거나 다시 시도할 것 포함) */
export function hasPendingFolderPush(): boolean {
  return pending.size > 0 || runningBatches.size > 0;
}

/**
 * 대기 중인 폴더 push를 즉시 시작하고 완료를 기다린다.
 *
 * 프레젠테이션 push 전에 부른다. 새 폴더로 옮긴 세트가 폴더보다 먼저 도착하면
 * 서버가 `folderId`를 루트로 보정하고, 다음 부팅 병합에서 그 값이 이긴다.
 */
export function flushFolderSync(): Promise<void> {
  run();
  return inFlight;
}

/**
 * 연결 회복 신호(`syncRecovery`)에 맞춰 대기 중인 폴더를 곧바로 올린다.
 *
 * `wake`는 서버가 거절해(5xx·429·401) 기다리는 중이면 백오프 타이머에 맡긴다. 포커스마다
 * 앞당기면 `Retry-After`를 어기고 서버 재시도 한도에 이르지 못한다. 기다리는 폴더만 빼고
 * 보내지 않는 것은 부모보다 자식이 먼저 도착하면 서버가 자식을 루트로 옮기기 때문이다.
 * `reconnect`·`manual`은 백오프를 비우고 모두 보낸다(`syncScheduler`와 같다). 비우지
 * 않으면 '다시 시도' 뒤 한 번 더 실패한 폴더가 지난 횟수 때문에 곧바로 영구 실패가 된다.
 * `manual`은 영구 실패로 남긴 폴더도 실패 기록을 지우고 다시 넣는다.
 */
export function retryFolderSyncNow(mode: SyncRetryMode): Promise<void> {
  if (mode === "manual") {
    for (const [id, folder] of failed) {
      clearSyncFailure("folder", id);
      if (!pending.has(id)) pending.set(id, folder);
    }
    failed = new Map();
  }
  if (mode !== "wake") backoff.reset();
  if (mode === "wake" && waitingOnServer) return inFlight;
  return flushFolderSync();
}

export function __setFolderPusherForTests(next: FolderPusher | null): void {
  pusher = next ?? pushFolder;
}

export function __setFolderBackoffRandomForTests(fn: () => number): void {
  backoff.__setRandomForTests(fn);
}

export function __resetFolderSyncForTests(): void {
  enabled = false;
  pusher = pushFolder;
  listener = null;
  goneListener = null;
  clearPending();
  inFlight = Promise.resolve();
  runningBatches.clear();
}
