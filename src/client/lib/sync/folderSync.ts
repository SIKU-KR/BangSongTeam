import { sortFoldersParentFirst, type Folder } from "#shared";
import {
  isRetryableApiError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import { pushFolder } from "./presentationSync";
import { setSyncStatus, type SyncFailure } from "./syncStatus";
import { BackoffTracker, MAX_RETRY_ATTEMPTS } from "./backoff";

const FOLDER_SYNC_DEBOUNCE_MS = 2000;

type FolderPusher = (folder: Folder) => Promise<Folder>;
type ServerFolderListener = (folder: Folder) => void;

let pusher: FolderPusher = pushFolder;
let listener: ServerFolderListener | null = null;
let enabled = false;
let pending = new Map<string, Folder>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();
const backoff = new BackoffTracker();

/** 로그인·하이드레이션이 끝난 뒤에만 켠다 (송출 화면에서는 켜지 않는다) */
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

function clearPending(): void {
  pending = new Map();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  backoff.reset();
}

async function pushAll(folders: Folder[]): Promise<void> {
  if (folders.length === 0) return;

  setSyncStatus("syncing");
  let offline = false;
  let failed = false;
  let minRetryDelay = Infinity;

  for (const folder of sortFoldersParentFirst(folders)) {
    try {
      const saved = await pusher(folder);
      listener?.(saved);
      backoff.reset(folder.id);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        failed = true;
        pending.delete(folder.id);
        backoff.reset(folder.id);
        setSyncStatus("error");
      } else if (
        err instanceof OfflineError ||
        (isRetryableApiError(err) &&
          backoff.getServerAttempt(folder.id) < MAX_RETRY_ATTEMPTS)
      ) {
        offline = true;
        if (!pending.has(folder.id)) pending.set(folder.id, folder);
        const delay = backoff.getDelay(folder.id, err);
        if (delay < minRetryDelay) minRetryDelay = delay;
      } else {
        failed = true;
        pending.delete(folder.id);
        backoff.reset(folder.id);
        const failure: SyncFailure = {
          id: folder.id,
          title: folder.name,
          kind: "folder",
          status:
            err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
        };
        console.error("Folder push failed permanently", failure);
        setSyncStatus("error", failure);
      }
    }
  }

  if (failed) {
    setSyncStatus("error");
  } else if (offline) {
    setSyncStatus("offline");
  } else {
    backoff.reset();
    setSyncStatus("synced");
  }
  if (offline && !timer && minRetryDelay !== Infinity) {
    timer = setTimeout(run, minRetryDelay);
  }
}

function run(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return;

  const folders = [...pending.values()];
  pending = new Map();
  inFlight = inFlight.then(() => pushAll(folders));
}

/** 같은 폴더를 연달아 고치면 마지막 것만 올린다 */
export function scheduleFolderPush(folder: Folder): void {
  if (!enabled) return;
  pending.set(folder.id, folder);
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, FOLDER_SYNC_DEBOUNCE_MS);
}

/** 영구 삭제한 폴더의 대기 중인 push를 취소한다 */
export function cancelFolderPush(id: string): void {
  pending.delete(id);
  backoff.reset(id);
}

/**
 * 폴더 1건을 지금 바로 올리고 서버 확정본을 돌려준다 (부팅 동기화).
 * 앞서 나간 같은 폴더의 push가 늦게 도착해 이번 것을 덮지 않도록 줄을 선다.
 */
export async function pushFolderNow(folder: Folder): Promise<Folder> {
  pending.delete(folder.id);
  backoff.reset(folder.id);
  await inFlight;
  const saved = await pusher(folder);
  listener?.(saved);
  return saved;
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
  clearPending();
  inFlight = Promise.resolve();
}
