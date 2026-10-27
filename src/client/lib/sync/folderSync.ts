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
  SLOW_RETRY_MS,
  type SyncRetryMode,
} from "./backoff";

const FOLDER_SYNC_DEBOUNCE_MS = 2000;

type FolderPusher = (folder: Folder) => Promise<Folder>;
type ServerFolderListener = (folder: Folder) => void;
type FolderGoneListener = (ids: readonly string[]) => unknown;
type FolderPushSettledListener = () => void;
type FailedFolderResolver = (id: string) => Folder | undefined;

let pusher: FolderPusher = pushFolder;
let listener: ServerFolderListener | null = null;
let goneListener: FolderGoneListener | null = null;
let settledListener: FolderPushSettledListener | null = null;
let resolveFailed: FailedFolderResolver | null = null;
let enabled = false;
let pending = new Map<string, Folder>();
let failed = new Map<string, Folder>();
const retrying = new Set<string>();
let waitingOnServer = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();
const runningBatches = new Map<Promise<void>, ReadonlySet<string>>();
const backoff = new BackoffTracker();

const noop = (): void => undefined;

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

/**
 * 폴더 큐가 일을 하나 마칠 때마다 부를 곳을 등록한다. 묶음이나 바로 올리기(`pushFolderNow`)가
 * 끝났을 때, 기다리던 폴더를 취소했을 때, 큐를 껐을 때 부른다. 프레젠테이션 큐가 켜질 때
 * 등록하고 꺼질 때 뗀다.
 *
 * 폴더가 오르기를 기다리며 붙잡아 둔 세트를 그 폴더가 오르자마자 놓아 주려는 것이다. 붙잡힌
 * 세트가 자기 타이머로 폴더를 다시 확인하면, 폴더가 오른 뒤에도 그 타이머까지 기다린다.
 */
export function setFolderPushSettledListener(
  next: FolderPushSettledListener | null,
): void {
  settledListener = next;
}

/**
 * '다시 시도'(`retryFolderSyncNow("manual")`)가 영구 실패로 남긴 폴더 대신 다시 넣을 지금
 * 폴더를 찾을 곳을 등록한다. 부팅 동기화가 폴더 스토어를 등록하고 `stopSync`가 뗀다. 없다고
 * 답한 폴더는 다시 넣지 않는다.
 *
 * 실패로 남긴 사본은 실패한 때의 판이라, 그사이 다른 탭에서 고쳐 다시 읽은 내용이나 병합이
 * 받은 서버 사본보다 낡았을 수 있다.
 */
export function setFailedFolderResolver(
  next: FailedFolderResolver | null,
): void {
  resolveFailed = next;
}

function notifySettled(): void {
  settledListener?.();
}

function isFolderGone(err: unknown): boolean {
  return err instanceof ServerRejectedError && err.status === 410;
}

function forgetGoneFolder(id: string): void {
  pending.delete(id);
  failed.delete(id);
  retrying.delete(id);
  backoff.reset(id);
  clearSyncFailure("folder", id);
  void goneListener?.([id]);
}

function clearPending(): void {
  pending = new Map();
  failed = new Map();
  retrying.clear();
  waitingOnServer = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  backoff.reset();
  notifySettled();
}

function isQueuedAfter(id: string, batch: ReadonlySet<string>): boolean {
  if (pending.has(id)) return true;
  for (const ids of runningBatches.values()) {
    if (ids !== batch && ids.has(id)) return true;
  }
  return false;
}

function failureOf(folder: Folder, err: unknown): SyncFailure {
  return {
    id: folder.id,
    title: folder.name,
    kind: "folder",
    status: err instanceof ServerRejectedError ? err.status : undefined,
    message: err instanceof Error ? err.message : String(err),
    failedAt: Date.now(),
    requestId: requestIdOfError(err),
    reason: syncFailureReasonOf(err),
  };
}

function waitsOnRetry(id: string): boolean {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null && !seen.has(current)) {
    if (retrying.has(current)) return true;
    seen.add(current);
    current = pending.get(current)?.parentId ?? null;
  }
  return false;
}

async function pushAll(
  folders: Folder[],
  batch: ReadonlySet<string>,
): Promise<void> {
  if (folders.length === 0) return;

  setSyncStatus("folder", "syncing");
  let offline = false;
  let sessionExpired = false;
  let slowRetry = false;
  let serverRejected = false;
  let deferred = false;
  let deferredBehindRetry = false;
  let minRetryDelay = Infinity;

  for (const folder of sortFoldersParentFirst(folders)) {
    if (!enabled) return;
    if (folder.parentId !== null && isQueuedAfter(folder.parentId, batch)) {
      if (!pending.has(folder.id)) pending.set(folder.id, folder);
      deferred = true;
      if (waitsOnRetry(folder.parentId)) deferredBehindRetry = true;
      continue;
    }
    try {
      const saved = await pusher(folder);
      listener?.(saved);
      backoff.reset(folder.id);
      retrying.delete(folder.id);
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
        retrying.add(folder.id);
        if (!pending.has(folder.id)) pending.set(folder.id, folder);
        const delay = backoff.getDelay(folder.id, err);
        if (delay < minRetryDelay) minRetryDelay = delay;
      } else if (isRetryableApiError(err)) {
        slowRetry = true;
        serverRejected = true;
        retrying.add(folder.id);
        if (!pending.has(folder.id)) pending.set(folder.id, folder);
        if (SLOW_RETRY_MS < minRetryDelay) minRetryDelay = SLOW_RETRY_MS;
        recordSyncFailure(failureOf(folder, err));
      } else {
        retrying.delete(folder.id);
        backoff.reset(folder.id);
        if (!pending.has(folder.id)) failed.set(folder.id, folder);
        const failure = failureOf(folder, err);
        console.error("Folder push failed permanently", failure);
        recordSyncFailure(failure);
      }
    }
  }

  const failedRetryably = offline || sessionExpired || slowRetry;
  if (failedRetryably) waitingOnServer = serverRejected;
  else if (!deferred) waitingOnServer = false;
  if (sessionExpired) {
    setSyncStatus("folder", "error");
  } else if (offline || slowRetry || deferredBehindRetry) {
    setSyncStatus("folder", "offline");
  } else if (!deferred) {
    backoff.reset();
    setSyncStatus("folder", "synced");
  }
  if (failedRetryably && !timer && minRetryDelay !== Infinity) {
    timer = setTimeout(run, minRetryDelay);
  }
  if (deferred && !timer) {
    timer = setTimeout(run, FOLDER_SYNC_DEBOUNCE_MS);
  }
}

function enqueue<T>(
  ids: ReadonlySet<string>,
  task: () => Promise<T>,
): Promise<T> {
  const result = inFlight.then(task);
  const entry: Promise<void> = result.then(noop, noop).then(() => {
    runningBatches.delete(entry);
  });
  runningBatches.set(entry, ids);
  inFlight = entry;
  return entry.then(() => {
    notifySettled();
    return result;
  });
}

function run(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!enabled || pending.size === 0) return;

  const folders = [...pending.values()];
  pending = new Map();
  const ids: ReadonlySet<string> = new Set(folders.map((folder) => folder.id));
  enqueue(ids, () => pushAll(folders, ids)).catch((err: unknown) => {
    console.error("Folder push batch failed", err);
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
  const wasPending = pending.delete(id);
  failed.delete(id);
  retrying.delete(id);
  backoff.reset(id);
  clearSyncFailure("folder", id);
  if (wasPending) notifySettled();
}

/**
 * 폴더 1건을 지금 바로 올리고 서버 확정본을 돌려준다 (부팅 동기화).
 *
 * 큐의 묶음과 한 줄에 서서 차례가 오면 보낸다. 앞서 나간 같은 폴더의 push가 늦게 도착해 이번
 * 것을 덮지 않고, 보내는 동안은 큐가 끝내지 못한 폴더로 센다(`isFolderPushPending`,
 * `flushFolderSync`). 그래서 영구 삭제는 부팅이 올리는 휴지통 폴더를 기다린 뒤에 지우고, 그
 * 폴더로 옮긴 세트는 폴더가 오른 뒤에 오른다. 등록을 지운 뒤에 돌아오므로, 부팅이 다음 폴더를
 * 올릴지 정할 때 방금 오른 부모를 아직 오르지 않은 폴더로 보지 않는다.
 *
 * 실패는 부른 쪽에 그대로 던진다. 일시 장애(오프라인·5xx·429·401)면 그 폴더가 다시 시도를
 * 기다린다고 남긴다. 부팅이 그 폴더를 큐에 넘긴 뒤, 그 안의 세트가 폴더 재시도를 앞당기지
 * 않는다(`ensureFolderPushed`). 다른 곳에서 영구 삭제한 폴더면(410) 지웠다고
 * 알리고(`setFolderGoneListener`) `null`이다.
 */
export async function pushFolderNow(folder: Folder): Promise<Folder | null> {
  pending.delete(folder.id);
  retrying.delete(folder.id);
  backoff.reset(folder.id);
  return enqueue(new Set([folder.id]), async () => {
    let saved: Folder;
    try {
      saved = await pusher(folder);
    } catch (err) {
      if (isFolderGone(err)) {
        forgetGoneFolder(folder.id);
        return null;
      }
      if (isRetryableApiError(err) || err instanceof SessionExpiredError) {
        retrying.add(folder.id);
      }
      throw err;
    }
    listener?.(saved);
    failed.delete(folder.id);
    clearSyncFailure("folder", folder.id);
    return saved;
  });
}

/**
 * 부팅 동기화가 올리다 영구 실패로 남긴 폴더를 맡긴다. 사용자가 '다시 시도'를 누르면
 * (`retryFolderSyncNow("manual")`) 큐가 다시 올린다.
 */
export function holdFailedFolderPush(folder: Folder): void {
  failed.set(folder.id, folder);
}

/**
 * 큐가 아직 끝내지 못한 폴더가 있는지. 기다리는 중, 보내는 중(부팅이 바로 올리는 폴더 포함),
 * 다시 시도할 것을 모두 센다.
 */
export function hasPendingFolderPush(): boolean {
  return pending.size > 0 || runningBatches.size > 0;
}

/**
 * 그 폴더의 push가 아직 끝나지 않았는지. 기다리는 중이거나 보내는 중(큐의 묶음, 부팅의 바로
 * 올리기)이면 참이다. 아직 서버에 없을 수 있는 폴더라, 그 안에 넣은 폴더·세트는 이 폴더가
 * 오른 뒤에 올린다. 서버는 모르는 폴더를 가리키는 폴더·세트를 루트로 옮겨 받고, 이 기기도 그
 * 위치를 따른다(폴더는 응답을 받자마자, 세트는 다음 부팅 병합에서).
 */
export function isFolderPushPending(id: string | null | undefined): boolean {
  if (!id) return false;
  if (pending.has(id)) return true;
  for (const ids of runningBatches.values()) {
    if (ids.has(id)) return true;
  }
  return false;
}

/**
 * 세트를 올리기 전에 그 세트의 폴더가 서버에 올랐는지 확인한다. 기다리는 push가 없으면 곧바로
 * 참이다.
 *
 * 폴더나 그 위의 기다리는 폴더가 일시 장애로 다시 시도를 기다리면 요청 없이 거짓이다. 세트마다
 * 폴더를 앞당겨 보내면 서버가 준 대기(`Retry-After`)를 어기고, 붙잡힌 세트 몇 개가 폴더의 서버
 * 재시도 한도를 몇 초 만에 다 쓴다. 그러면 폴더가 영구 실패로 남고 세트는 결국 루트로 옮겨진다.
 * 그 밖에 아직 기다리는 폴더면 큐를 지금 돌리고, 큐가 끝날 때까지 기다린 뒤 폴더가 올랐는지
 * 답한다. 영구 실패한 폴더는 기다리지 않는다. 그 안의 세트는 서버가 루트로 옮겨 받아, 내용은
 * 서버에 간다.
 */
export async function ensureFolderPushed(
  id: string | null | undefined,
): Promise<boolean> {
  if (!id || !isFolderPushPending(id)) return true;
  if (waitsOnRetry(id)) return false;
  if (pending.has(id)) run();
  await inFlight;
  return !isFolderPushPending(id);
}

/**
 * 대기 중인 폴더 push를 디바운스·백오프를 기다리지 않고 지금 보내고, 큐가 끝날 때까지 기다린다.
 * 부팅이 바로 올리는 폴더도 기다린다.
 *
 * 창을 닫을 때(`pagehide`), 로그아웃하기 전, 영구 삭제하기 전에 부른다. 닫히는 페이지에 남긴
 * 폴더 변경은 다음 부팅까지 서버에 가지 않고, 영구 삭제는 휴지통에 넣거나 폴더 밖으로 꺼낸
 * 변경이 서버에 닿은 뒤에 해야 한다. 세트 push는 이것을 부르지 않고 자기 폴더만
 * 기다린다(`ensureFolderPushed`).
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
 *
 * `manual`은 영구 실패로 남긴 폴더도 다시 넣고, 다시 보내는 폴더의 실패 기록을 지운다. 실패한
 * 사본이 아니라 지금 폴더를 넣고(`setFailedFolderResolver`), 그사이 없어진 폴더는 버린다. 재시도
 * 한도를 넘겨 `SLOW_RETRY_MS`마다 다시 보내던 폴더도 곧바로 보낸다.
 */
export function retryFolderSyncNow(mode: SyncRetryMode): Promise<void> {
  if (mode === "manual") {
    for (const id of pending.keys()) clearSyncFailure("folder", id);
    requeueFailedFolders();
  }
  if (mode !== "wake") backoff.reset();
  if (mode === "wake" && waitingOnServer) return inFlight;
  return flushFolderSync();
}

function requeueFailedFolders(): void {
  for (const [id, folder] of failed) {
    clearSyncFailure("folder", id);
    if (pending.has(id)) continue;
    const current = resolveFailed ? resolveFailed(id) : folder;
    if (current) pending.set(id, current);
  }
  failed = new Map();
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
  settledListener = null;
  resolveFailed = null;
  clearPending();
  inFlight = Promise.resolve();
  runningBatches.clear();
}
