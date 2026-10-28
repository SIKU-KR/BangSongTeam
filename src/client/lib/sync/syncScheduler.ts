import type { Presentation } from "#shared";
import {
  isRetryableApiError,
  isTransientServerError,
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
import {
  ensureFolderPushed,
  flushFolderSync,
  isFolderPushPending,
  setFolderPushSettledListener,
} from "./folderSync";
import {
  BackoffTracker,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  SLOW_RETRY_MS,
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
  heldForFolder: boolean;
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
 * 꺼져 있는 동안에는 담긴 폴더가 오르기를 기다리던 push도 보내지 않는다. 계정이 끝난
 * 탭(`stopSync`)은 새로고침할 때까지 큐를 꺼 두고, 송출 중이면 송출을 마칠 때까지 새로고침을
 * 미룬다. 그사이 요청이 나가면 다른 계정의 쿠키로 간다.
 *
 * 켜 있는 동안에는 폴더 큐가 일을 마칠 때마다 알림을 받아(`setFolderPushSettledListener`) 폴더를
 * 기다리며 붙잡아 둔 세트를 놓아 준다.
 */
export function setSyncEnabled(next: boolean): void {
  enabled = next;
  setFolderPushSettledListener(next ? releaseHeldDocumentPushes : null);
  if (!next) clearPending();
}

function holdForFolder(document: Presentation): void {
  if (cancelledInFlight.has(document.id)) return;
  const existing = pending.get(document.id);
  if (existing && !isFolderPushPending(existing.document.folderId)) return;
  const now = Date.now();
  const safetyReadyAt = now + MAX_BACKOFF_MS;
  if (existing) {
    existing.heldForFolder = true;
    existing.waitingOnServer = true;
    existing.readyAt = Math.max(existing.readyAt, safetyReadyAt);
  } else {
    pending.set(document.id, {
      document,
      firstScheduledAt: now,
      readyAt: safetyReadyAt,
      waitingOnServer: true,
      heldForFolder: true,
    });
  }
  setSyncStatus("presentation", "offline");
}

function releaseHeldDocumentPushes(): void {
  let released = false;
  for (const item of pending.values()) {
    if (!item.heldForFolder || isFolderPushPending(item.document.folderId)) {
      continue;
    }
    item.heldForFolder = false;
    item.waitingOnServer = false;
    item.readyAt = 0;
    released = true;
  }
  if (released) dispatch();
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
  timer = setTimeout(() => dispatch(), delay);
}

function requeueAfter(
  document: Presentation,
  delay: number,
  waitingOnServer: boolean,
): void {
  const now = Date.now();
  const existing = pending.get(document.id);
  if (existing) {
    existing.readyAt = Math.max(existing.readyAt, now + delay);
    existing.waitingOnServer = waitingOnServer;
    return;
  }
  pending.set(document.id, {
    document,
    firstScheduledAt: now,
    readyAt: now + delay,
    waitingOnServer,
    heldForFolder: false,
  });
}

function failureOf(document: Presentation, err: unknown): SyncFailure {
  return {
    id: document.id,
    title: document.title,
    kind: "presentation",
    status: err instanceof ServerRejectedError ? err.status : undefined,
    message: err instanceof Error ? err.message : String(err),
    failedAt: Date.now(),
    requestId: requestIdOfError(err),
    reason: syncFailureReasonOf(err),
  };
}

function startPush(document: Presentation): void {
  setSyncStatus("presentation", "syncing");
  const task = (async (): Promise<void> => {
    try {
      const folderReady = await ensureFolderPushed(document.folderId);
      if (!enabled) return;
      if (!folderReady) {
        holdForFolder(document);
        return;
      }
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
        requeueAfter(
          document,
          backoff.getDelay(document.id, err),
          err instanceof ServerRejectedError || sessionExpired,
        );
        setSyncStatus("presentation", sessionExpired ? "error" : "offline");
      } else if (isTransientServerError(err)) {
        requeueAfter(document, SLOW_RETRY_MS, true);
        recordSyncFailure(failureOf(document, err));
        setSyncStatus("presentation", "offline");
      } else {
        backoff.reset(document.id);
        if (!pending.has(document.id)) failed.set(document.id, document);
        const failure = failureOf(document, err);
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

function dispatch(concurrency = PUSH_CONCURRENCY): void {
  if (!enabled) return;
  clearTimer();
  if (isProjecting()) {
    if (pending.size > 0) timer = setTimeout(() => dispatch(), BASE_BACKOFF_MS);
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

  while (inFlightDocs.size < concurrency && readyItems.length > 0) {
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
 * 다시 센다. `manual`은 영구 실패로 남긴 항목도 다시 넣고, 다시 보내는 항목의 실패 기록을
 * 지운다. 재시도 한도를 넘겨 `SLOW_RETRY_MS`마다 다시 보내던 항목도 곧바로 보낸다. 송출 중에는
 * 앞당긴 항목도 송출을 마칠 때까지 보내지 않는다(`flushPendingSync` 참고).
 */
export function retryPendingSyncNow(mode: SyncRetryMode): void {
  if (!enabled) return;
  if (mode === "manual") requeueFailedDocuments();
  if (mode !== "wake") backoff.reset();
  for (const [id, item] of pending) {
    if (mode === "wake" && item.waitingOnServer) continue;
    if (mode === "manual") clearSyncFailure("presentation", id);
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
      heldForFolder: false,
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
 *
 * 담긴 폴더가 아직 서버에 오르지 않았으면 그 폴더가 오를 때까지 붙잡아 둔다
 * (`ensureFolderPushed`). 먼저 올리면 서버가 세트를 루트로 옮겨 받고, 다음 부팅 병합에서 그
 * 위치가 이긴다. 붙잡힌 세트는 폴더가 일시 장애로 다시 시도를 기다리는 동안 폴더를 앞당겨
 * 보내지 않는다. 세트마다 앞당기면 붙잡힌 세트 몇 개가 폴더의 서버 재시도 한도를 몇 초 만에
 * 다 쓰고 서버가 준 대기(`Retry-After`)를 어긴다. 폴더 큐가 그 폴더를 올리면 곧바로 놓아 주고,
 * 알림을 놓쳐도 `MAX_BACKOFF_MS`마다 다시 확인한다. 붙잡힌 세트를 다른 폴더나 루트로 옮기면
 * 보통 디바운스를 따른다.
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
  const wasHeld = existing?.heldForFolder ?? false;
  const heldForFolder = wasHeld && isFolderPushPending(document.folderId);
  const keepsWait =
    existing !== undefined &&
    existing.readyAt > now &&
    (heldForFolder || !wasHeld);
  const readyAt =
    existing && keepsWait
      ? Math.max(existing.readyAt, debounceReady)
      : debounceReady;

  failed.delete(document.id);
  cancelledInFlight.delete(document.id);
  pending.set(document.id, {
    document,
    firstScheduledAt,
    readyAt,
    waitingOnServer: wasHeld
      ? heldForFolder
      : (existing?.waitingOnServer ?? false),
    heldForFolder,
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

/**
 * 그 세트의 보내는 중인 push를 취소했는지(`cancelDocumentPush`). 그 push가 끝나거나 그 세트를 다시
 * 넣으면 거짓이 된다.
 *
 * 취소한 push의 결과(서버 판 받기, 사본 남기기)는 반영하지 않는다. 지운 세트를 되살리거나 영구 삭제하는
 * 세트의 사본을 휴지통에 남기게 된다.
 */
export function isDocumentPushCancelled(id: string): boolean {
  return cancelledInFlight.has(id);
}

/**
 * 큐가 아직 끝내지 못한 프레젠테이션이 있는지. 보내는 중, 다시 시도할 것, 담긴 폴더가 오르기를
 * 기다리며 붙잡아 둔 것을 모두 센다.
 */
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
 * 송출 화면으로 가기 직전에 부른다. 기다리는 push를 디바운스·백오프·동시 개수 제한 없이 지금 모두
 * 보낸다.
 *
 * 송출하는 동안 큐는 보내지 않는다. 남긴 세트는 예배 내내 서버에 없다가 송출을 마친 뒤에야 송출
 * 전 판으로 올라가, 그사이 다른 기기나 탭이 고친 내용을 서버에서 되돌린다. 송출 화면에서 탭을
 * 닫으면 그 편집은 다음 부팅까지 서버에 가지 않는다. 같은 세트를 이미 보내는 중이면 새 판은 그
 * 요청이 끝난 뒤, 송출을 마치고 보낸다(세트마다 PATCH는 하나씩). 송출 중에 부르면 아무것도 하지
 * 않는다.
 */
export function flushBeforeProjection(): void {
  if (!enabled || isProjecting()) return;
  for (const item of pending.values()) {
    item.readyAt = 0;
  }
  dispatch(Infinity);
}

async function settleInFlight(): Promise<void> {
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

async function sendPendingDocuments(): Promise<void> {
  for (const item of pending.values()) {
    item.readyAt = 0;
  }
  dispatch();
  await settleInFlight();
}

/**
 * 대기 중인 폴더·세트 push를 디바운스·백오프를 기다리지 않고 보내고, 보낸 것이 모두 끝날
 * 때까지 기다린다. 창을 닫을 때(`pagehide`), 로그아웃하기 전, 영구 삭제하기 전에 부른다.
 *
 * 폴더 큐도 함께 비운다. 세트 push는 자기 폴더만 기다려(`ensureFolderPushed`) 다른 폴더의
 * 변경은 남기기 때문이다. 담긴 폴더가 오르기를 기다리며 붙잡아 둔 세트는 그 폴더가 오르면
 * 놓아 주고, 그 push까지 기다린다. 같은 세트는 한 번에 하나만 보내므로, 보내는 중인 세트의 새
 * 판은 앞 요청이 끝난 뒤 보낸다.
 *
 * 송출 중에는 폴더도 세트도 새로 보내지 않고 이미 나간 요청이 끝나기만 기다린다. 송출 화면은
 * 서버 요청이 0건이어야 한다. 큐는 송출하는 동안 몇 초마다 다시 보고, 송출을 마치면 남은 세트를
 * 보낸다. 그동안 바뀐 내용은 저장소에 남아 있어 탭을 닫아도 다음 부팅이 올린다.
 */
export async function flushPendingSync(): Promise<void> {
  if (!enabled) return;
  const folders = isProjecting() ? null : flushFolderSync();
  await sendPendingDocuments();
  if (!folders) return;
  await folders;
  await settleInFlight();
}

/**
 * 부팅 동기화가 큐에 넣은 세트를 디바운스를 기다리지 않고 보내고, 보낸 것이 끝날 때까지
 * 기다린다. `flushPendingSync`와 달리 폴더 큐를 먼저 비우지 않는다.
 *
 * 일시 장애로 다시 시도를 기다리는 폴더(부팅이 올리다 실패한 폴더 포함)는 큐의 백오프를 따라 다시
 * 오르고, 그 안의 세트는 그 폴더를 앞당기지 않고 폴더가 오를 때까지 큐가 붙잡아 둔다. 부팅이 폴더
 * 큐를 비우면 서버가 준 대기(`Retry-After`)를 어기고 실패한 폴더를 곧바로 다시 보내며, 그 재시도를
 * 기다리느라 부팅의 다음 단계(보관함 받기)가 늦는다. 다만 담긴 폴더가 다시 시도 없이 큐에서
 * 기다리면(방금 고친 폴더) 세트가 폴더 큐를 지금 돌리고 끝날 때까지 기다리므로(`ensureFolderPushed`),
 * 부팅도 그 큐를 기다린다. 그 큐는 다시 시도를 기다리던 다른 폴더도 함께 보낸다.
 */
export async function flushDocumentPushes(): Promise<void> {
  if (!enabled) return;
  await sendPendingDocuments();
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
