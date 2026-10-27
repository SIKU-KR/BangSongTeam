import type { Presentation } from "#shared";
import {
  isRetryableApiError,
  requestIdOfError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import { pushPresentation, syncFailureReasonOf } from "./presentationSync";
import {
  clearSyncFailure,
  getSyncDomainStatus,
  recordSyncFailure,
  setSyncStatus,
  type SyncFailure,
} from "./syncStatus";
import { flushFolderSync } from "./folderSync";
import {
  BackoffTracker,
  BASE_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  type SyncRetryMode,
} from "./backoff";
import { isProjecting } from "../../features/presentation/fullscreen";

/** 입력이 멈춘 뒤 이만큼 조용하면 올린다 */
export const SYNC_DEBOUNCE_MS = 3000;
/** 쉬지 않고 입력해도 첫 변경 뒤 이 시간 안에는 올린다 */
export const SYNC_MAX_WAIT_MS = 10_000;
/** 서로 다른 문서를 동시에 올리는 최대 개수 */
const PUSH_CONCURRENCY = 3;

type Pusher = (document: Presentation) => Promise<unknown>;

interface PendingItem {
  document: Presentation;
  firstScheduledAt: number;
  readyAt: number;
  waitingOnServer: boolean;
}

let pusher: Pusher = pushPresentation;
let enabled = false;
let pending = new Map<string, PendingItem>();
let failed = new Map<string, Presentation>();
const inFlightDocs = new Set<string>();
const cancelledInFlight = new Set<string>();
const inFlightTasks = new Set<Promise<void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
const backoff = new BackoffTracker();

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function clearPending(): void {
  pending = new Map();
  failed = new Map();
  clearTimer();
  backoff.reset();
}

/**
 * 로그인·하이드레이션이 끝난 뒤에만 켠다.
 *
 * 꺼져 있는 동안에는 폴더 큐를 먼저 비우던 push도 보내지 않는다. 계정이 끝난 탭(`stopSync`)은
 * 새로고침할 때까지 큐를 꺼 두고, 송출 중이면 송출을 마칠 때까지 새로고침을 미룬다. 그사이
 * 요청이 나가면 다른 계정의 쿠키로 간다.
 */
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
      if (!enabled) return;
      await pusher(document);
      backoff.reset(document.id);
      failed.delete(document.id);
      clearSyncFailure("presentation", document.id);
      if (inFlightDocs.size === 1 && pending.size === 0) {
        setSyncStatus("presentation", "synced");
      }
    } catch (err) {
      if (cancelledInFlight.has(document.id)) return;
      const sessionExpired = err instanceof SessionExpiredError;
      if (
        err instanceof OfflineError ||
        ((isRetryableApiError(err) || sessionExpired) &&
          backoff.getServerAttempt(document.id) < MAX_RETRY_ATTEMPTS)
      ) {
        const delay = backoff.getDelay(document.id, err);
        const now = Date.now();
        const waitingOnServer =
          err instanceof ServerRejectedError || sessionExpired;
        const existing = pending.get(document.id);
        if (existing) {
          existing.readyAt = Math.max(existing.readyAt, now + delay);
          existing.waitingOnServer = waitingOnServer;
        } else {
          pending.set(document.id, {
            document,
            firstScheduledAt: now,
            readyAt: now + delay,
            waitingOnServer,
          });
        }
        setSyncStatus("presentation", sessionExpired ? "error" : "offline");
      } else {
        pending.delete(document.id);
        backoff.reset(document.id);
        failed.set(document.id, document);
        const failure: SyncFailure = {
          id: document.id,
          title: document.title,
          kind: "presentation",
          status: err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
          requestId: requestIdOfError(err),
          reason: syncFailureReasonOf(err),
        };
        console.error("Presentation push failed permanently", failure);
        recordSyncFailure(failure);
      }
    } finally {
      cancelledInFlight.delete(document.id);
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
  if (isProjecting()) {
    if (pending.size > 0) timer = setTimeout(dispatch, BASE_BACKOFF_MS);
    return;
  }

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

/**
 * 연결 회복 신호(`syncRecovery`)에 맞춰 대기 중인 push를 디바운스·백오프를 기다리지 않고
 * 곧바로 보낸다. 여기서 `online`을 따로 들으면 회복 경로가 둘이 된다.
 *
 * `wake`(포커스·탭 복귀·상태 확인 성공)는 서버가 거절해(5xx·429·401) 기다리는 항목을 앞당기지
 * 않고 백오프 횟수도 그대로 둔다. 그래야 `Retry-After`를 지키고 서버 재시도 한도에 이른다.
 * `reconnect`·`manual`은 백오프를 비우고 모두 보낸다. 회복 뒤 다시 실패하면 짧은 간격부터
 * 다시 센다. `manual`은 영구 실패로 남긴 항목도 실패 기록을 지우고 다시 넣는다. 송출 중에는
 * 앞당긴 항목도 송출을 마칠 때까지 보내지 않는다(`flushPendingSync` 참고).
 */
export function retryPendingSyncNow(mode: SyncRetryMode): void {
  if (!enabled) return;
  if (mode === "manual") requeueFailedDocuments();
  if (mode !== "wake") backoff.reset();
  for (const item of pending.values()) {
    if (mode === "wake" && item.waitingOnServer) continue;
    item.readyAt = 0;
  }
  dispatch();
}

function requeueFailedDocuments(): void {
  const now = Date.now();
  for (const [id, document] of failed) {
    clearSyncFailure("presentation", id);
    if (pending.has(id) || inFlightDocs.has(id)) continue;
    pending.set(id, {
      document,
      firstScheduledAt: now,
      readyAt: 0,
      waitingOnServer: false,
    });
  }
  failed = new Map();
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

  const now = Date.now();
  const existing = pending.get(document.id);
  const firstScheduledAt = existing ? existing.firstScheduledAt : now;
  const deadline = firstScheduledAt + SYNC_MAX_WAIT_MS;
  const debounceReady = Math.min(now + SYNC_DEBOUNCE_MS, deadline);
  const readyAt =
    existing && existing.readyAt > now
      ? Math.max(existing.readyAt, debounceReady)
      : debounceReady;

  failed.delete(document.id);
  cancelledInFlight.delete(document.id);
  pending.set(document.id, {
    document,
    firstScheduledAt,
    readyAt,
    waitingOnServer: existing?.waitingOnServer ?? false,
  });
  scheduleNextTimer();
}

/**
 * 대기 중인 push 1건을 취소한다 (영구 삭제한 문서).
 * 이미 나간 요청은 되돌릴 수 없으므로 호출자는 `flushPendingSync()`로 기다린다.
 * 지운 문서의 실패 기록도 함께 지운다. 없는 문서 때문에 헤더가 계속 빨갛게 남으면 안 된다.
 *
 * 보내는 중인 push는 끝났을 때 실패로 남기거나 다시 넣지 않는다(그 뒤 다시 넣으면 다시 센다).
 * 남기면 '다시 시도'가 지운 세트를 다시 넣고, 오프라인으로 끝난 push는 연결이 돌아올 때 지운
 * 세트를 올린다.
 */
export function cancelDocumentPush(id: string): void {
  pending.delete(id);
  failed.delete(id);
  if (inFlightDocs.has(id)) cancelledInFlight.add(id);
  backoff.reset(id);
  clearSyncFailure("presentation", id);
  scheduleNextTimer();
}

/** 큐가 아직 끝내지 못한 프레젠테이션이 있는지 (보내는 중이거나 다시 시도할 것 포함) */
export function hasPendingDocumentPush(): boolean {
  return pending.size > 0 || inFlightDocs.size > 0;
}

/**
 * 큐가 그 세트를 아직 끝내지 못했는지. 기다리는 중, 보내는 중, 영구 실패로 맡아 '다시 시도'를
 * 기다리는 것을 모두 센다. 다른 탭이 쓴 저장본을 다시 읽을지 정할 때 쓴다. 이 탭이 아직 서버에
 * 올리지 못한 판을 들고 있으면 다시 읽지 않는다.
 */
export function isDocumentQueued(id: string): boolean {
  return pending.has(id) || inFlightDocs.has(id) || failed.has(id);
}

/**
 * 대기 중인 push를 디바운스·백오프를 기다리지 않고 보내고, 보낸 것이 모두 끝날 때까지 기다린다.
 * 같은 세트는 한 번에 하나만 보내므로, 보내는 중인 세트의 새 판은 앞 요청이 끝난 뒤 보낸다.
 *
 * 송출 중에는 새로 보내지 않고 이미 나간 요청이 끝나기만 기다린다. 송출 화면은 서버 요청이
 * 0건이어야 한다. 큐는 송출하는 동안 몇 초마다 다시 보고, 송출을 마치면 남은 세트를 보낸다.
 * 그동안 바뀐 내용은 저장소에 남아 있어 탭을 닫아도 다음 부팅이 올린다.
 */
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
  cancelledInFlight.clear();
  inFlightTasks.clear();
  backoff.reset();
}
