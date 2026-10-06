import type { Presentation } from "#shared";
import {
  isRetryableApiError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import { pushPresentation } from "./presentationSync";
import {
  clearSyncFailure,
  getSyncDomainStatus,
  recordSyncFailure,
  setSyncStatus,
  type SyncFailure,
} from "./syncStatus";
import { flushFolderSync } from "./folderSync";
import { BackoffTracker, MAX_RETRY_ATTEMPTS } from "./backoff";

/** 입력이 멈춘 뒤 이만큼 조용하면 올린다 */
export const SYNC_DEBOUNCE_MS = 3000;
/** 쉬지 않고 입력해도 첫 변경 뒤 이 시간 안에는 올린다 */
export const SYNC_MAX_WAIT_MS = 10_000;
/** 서로 다른 문서를 동시에 올리는 최대 개수 */
const PUSH_CONCURRENCY = 3;

type Pusher = (document: Presentation) => Promise<boolean>;

interface PendingItem {
  document: Presentation;
  firstScheduledAt: number;
  readyAt: number;
}

let pusher: Pusher = pushPresentation;
let enabled = false;
let pending = new Map<string, PendingItem>();
const inFlightDocs = new Set<string>();
const inFlightTasks = new Set<Promise<void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
const backoff = new BackoffTracker();
let onlineListenerRegistered = false;

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function clearPending(): void {
  pending = new Map();
  clearTimer();
  backoff.reset();
}

/** 로그인·하이드레이션이 끝난 뒤에만 켠다 */
export function setSyncEnabled(next: boolean): void {
  enabled = next;
  if (!next) clearPending();
}

function scheduleNextTimer(): void {
  clearTimer();
  if (!enabled || pending.size === 0) return;

  const now = Date.now();
  let earliest = Infinity;

  for (const [id, item] of pending.entries()) {
    if (inFlightDocs.has(id)) continue;
    if (item.readyAt < earliest) {
      earliest = item.readyAt;
    }
  }

  if (earliest === Infinity) return;
  const delay = Math.max(0, earliest - now);
  timer = setTimeout(dispatch, delay);
}

function startPush(document: Presentation): void {
  setSyncStatus("presentation", "syncing");
  const task = (async (): Promise<void> => {
    try {
      await flushFolderSync();
      await pusher(document);
      backoff.reset(document.id);
      clearSyncFailure("presentation", document.id);
      if (inFlightDocs.size === 1 && pending.size === 0) {
        setSyncStatus("presentation", "synced");
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        pending.delete(document.id);
        backoff.reset(document.id);
        setSyncStatus("presentation", "error");
      } else if (
        err instanceof OfflineError ||
        (isRetryableApiError(err) &&
          backoff.getServerAttempt(document.id) < MAX_RETRY_ATTEMPTS)
      ) {
        const delay = backoff.getDelay(document.id, err);
        const now = Date.now();
        const existing = pending.get(document.id);
        if (existing) {
          existing.readyAt = Math.max(existing.readyAt, now + delay);
        } else {
          pending.set(document.id, {
            document,
            firstScheduledAt: now,
            readyAt: now + delay,
          });
        }
        setSyncStatus("presentation", "offline");
      } else {
        pending.delete(document.id);
        backoff.reset(document.id);
        const failure: SyncFailure = {
          id: document.id,
          title: document.title,
          kind: "presentation",
          status: err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
        };
        console.error("Presentation push failed permanently", failure);
        recordSyncFailure(failure);
      }
    } finally {
      inFlightDocs.delete(document.id);
      if (
        inFlightDocs.size === 0 &&
        pending.size === 0 &&
        getSyncDomainStatus("presentation") === "syncing"
      ) {
        setSyncStatus("presentation", "synced");
      }
      dispatch();
    }
  })();

  inFlightTasks.add(task);
  void task.finally(() => {
    inFlightTasks.delete(task);
  });
}

function dispatch(): void {
  if (!enabled) return;
  clearTimer();

  const now = Date.now();
  const readyItems: PendingItem[] = [];

  for (const [id, item] of pending.entries()) {
    if (!inFlightDocs.has(id) && now >= item.readyAt) {
      readyItems.push(item);
    }
  }

  readyItems.sort((a, b) => a.readyAt - b.readyAt);

  while (inFlightDocs.size < PUSH_CONCURRENCY && readyItems.length > 0) {
    const item = readyItems.shift()!;
    pending.delete(item.document.id);
    inFlightDocs.add(item.document.id);
    startPush(item.document);
  }

  scheduleNextTimer();
}

function handleOnline(): void {
  if (!enabled) return;
  backoff.reset();
  for (const item of pending.values()) {
    item.readyAt = 0;
  }
  dispatch();
}

function registerOnlineListener(): void {
  if (onlineListenerRegistered || typeof window === "undefined") return;
  onlineListenerRegistered = true;
  window.addEventListener("online", handleOnline);
}

/**
 * 문서 1건을 서버 push 큐에 넣는다.
 *
 * 활성 문서만 넣지 않는다 — 기존 IndexedDB 스케줄러의 제약을 물려받으면
 * 비활성 문서 변경이 영영 안 올라간다.
 *
 * 변경이 멈추면 `SYNC_DEBOUNCE_MS` 뒤에 올리되, 쉬지 않고 고쳐도 큐가 처음 찬
 * 뒤 `SYNC_MAX_WAIT_MS` 안에는 올린다. 그러지 않으면 긴 입력 동안 서버에 아무것도
 * 남지 않는다.
 */
export function scheduleDocumentPush(document: Presentation): void {
  if (!enabled) return;
  if (!document.id) return;
  if (document.access) return;

  registerOnlineListener();

  const now = Date.now();
  const existing = pending.get(document.id);
  const firstScheduledAt = existing ? existing.firstScheduledAt : now;
  const deadline = firstScheduledAt + SYNC_MAX_WAIT_MS;
  const debounceReady = Math.min(now + SYNC_DEBOUNCE_MS, deadline);
  const readyAt =
    existing && existing.readyAt > now
      ? Math.max(existing.readyAt, debounceReady)
      : debounceReady;

  pending.set(document.id, { document, firstScheduledAt, readyAt });
  scheduleNextTimer();
}

/**
 * 대기 중인 push 1건을 취소한다 (영구 삭제한 문서).
 * 이미 나간 요청은 되돌릴 수 없으므로 호출자는 `flushPendingSync()`로 기다린다.
 * 지운 문서의 실패 기록도 함께 지운다. 없는 문서 때문에 헤더가 계속 빨갛게 남으면 안 된다.
 */
export function cancelDocumentPush(id: string): void {
  pending.delete(id);
  backoff.reset(id);
  clearSyncFailure("presentation", id);
  scheduleNextTimer();
}

/** 아직 서버에 보내지 않은 프레젠테이션이 큐에 남아 있는지 (다시 시도할 것 포함) */
export function hasPendingDocumentPush(): boolean {
  return pending.size > 0;
}

export async function flushPendingSync(): Promise<void> {
  if (!enabled) return;
  for (const item of pending.values()) {
    item.readyAt = 0;
  }
  dispatch();

  while (inFlightTasks.size > 0) {
    await Promise.all(Array.from(inFlightTasks));
    let hasReady = false;
    for (const [id, item] of pending.entries()) {
      if (!inFlightDocs.has(id) && item.readyAt === 0) {
        hasReady = true;
        break;
      }
    }
    if (hasReady && inFlightDocs.size < PUSH_CONCURRENCY) {
      dispatch();
    }
  }
}

export function __setPusherForTests(next: Pusher | null): void {
  pusher = next ?? pushPresentation;
}

export function __setBackoffRandomForTests(fn: () => number): void {
  backoff.__setRandomForTests(fn);
}

export function __resetSyncSchedulerForTests(): void {
  enabled = false;
  pusher = pushPresentation;
  clearPending();
  inFlightDocs.clear();
  inFlightTasks.clear();
  backoff.reset();
}
