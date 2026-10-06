import type { Deck } from "#shared";
import {
  isRetryableApiError,
  requestIdOfError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import { pushDeck, deleteDeckRemote } from "./presentationSync";
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

const DECK_SYNC_DEBOUNCE_MS = 2000;

type DeckPusher = (deck: Deck) => Promise<Deck>;
type DeckDeleter = (id: string) => Promise<void>;
type ServerDeckListener = (deck: Deck) => void;

type PendingOp = { kind: "push"; deck: Deck } | { kind: "delete"; id: string };

let pusher: DeckPusher = pushDeck;
let deleter: DeckDeleter = deleteDeckRemote;
let listener: ServerDeckListener | null = null;
let enabled = false;
let pending = new Map<string, PendingOp>();
let failed = new Map<string, PendingOp>();
const waitingOnServer = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();
const runningBatches = new Set<Promise<void>>();
const backoff = new BackoffTracker();

/** 로그인·하이드레이션이 끝난 뒤에만 켠다 (송출 화면에서는 켜지 않는다) */
export function setDeckSyncEnabled(next: boolean): void {
  enabled = next;
  if (!next) clearPending();
}

export function setServerDeckListener(next: ServerDeckListener | null): void {
  listener = next;
}

function clearPending(): void {
  pending = new Map();
  failed = new Map();
  waitingOnServer.clear();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  backoff.reset();
}

async function runOps(ops: PendingOp[]): Promise<void> {
  if (ops.length === 0) return;

  setSyncStatus("deck", "syncing");
  let offline = false;
  let sessionExpired = false;
  let minRetryDelay = Infinity;

  for (const op of ops) {
    const key = op.kind === "push" ? op.deck.id : op.id;
    try {
      if (op.kind === "push") {
        const saved = await pusher(op.deck);
        listener?.(saved);
      } else {
        await deleter(op.id);
      }
      backoff.reset(key);
      waitingOnServer.delete(key);
      failed.delete(key);
      clearSyncFailure("deck", key);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        sessionExpired = true;
        pending.delete(key);
        waitingOnServer.delete(key);
        backoff.reset(key);
      } else if (
        err instanceof OfflineError ||
        (isRetryableApiError(err) &&
          backoff.getServerAttempt(key) < MAX_RETRY_ATTEMPTS)
      ) {
        offline = true;
        if (err instanceof ServerRejectedError) waitingOnServer.add(key);
        else waitingOnServer.delete(key);
        if (!pending.has(key)) pending.set(key, op);
        const delay = backoff.getDelay(key, err);
        if (delay < minRetryDelay) minRetryDelay = delay;
      } else {
        pending.delete(key);
        waitingOnServer.delete(key);
        backoff.reset(key);
        failed.set(key, op);
        const failure: SyncFailure = {
          id: key,
          title: op.kind === "push" ? op.deck.title : undefined,
          kind: "deck",
          status: err instanceof ServerRejectedError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
          requestId: requestIdOfError(err),
        };
        console.error("Deck push failed permanently", failure);
        recordSyncFailure(failure);
      }
    }
  }

  if (sessionExpired) {
    setSyncStatus("deck", "error");
  } else if (offline || waitingOnServer.size > 0) {
    setSyncStatus("deck", "offline");
  } else {
    backoff.reset();
    setSyncStatus("deck", "synced");
  }
  if (offline && !timer && minRetryDelay !== Infinity) {
    timer = setTimeout(run, minRetryDelay);
  }
}

function startBatch(ops: PendingOp[]): void {
  const batch = inFlight.then(() => runOps(ops));
  runningBatches.add(batch);
  inFlight = batch.finally(() => {
    runningBatches.delete(batch);
  });
}

function run(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return;

  const ops = [...pending.values()];
  pending = new Map();
  startBatch(ops);
}

function runNotWaitingOnServer(): void {
  const ops: PendingOp[] = [];
  for (const [key, op] of pending) {
    if (waitingOnServer.has(key)) continue;
    pending.delete(key);
    ops.push(op);
  }
  if (ops.length > 0) startBatch(ops);
}

function schedule(key: string, op: PendingOp): void {
  if (!enabled) return;
  failed.delete(key);
  pending.set(key, op);
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DECK_SYNC_DEBOUNCE_MS);
}

/** 같은 곡을 연달아 고치면 마지막 것만 올린다 */
export function scheduleDeckPush(deck: Deck): void {
  schedule(deck.id, { kind: "push", deck });
}

/** 대기 중인 push와 그 push의 실패 기록은 버린다 (지운 곡을 올릴 일은 없다) */
export function scheduleDeckDelete(id: string): void {
  backoff.reset(id);
  clearSyncFailure("deck", id);
  schedule(id, { kind: "delete", id });
}

/**
 * 곡 1건을 지금 바로 올리고 서버가 확정한 덱을 돌려준다.
 *
 * 공개 전환처럼 '서버에 이 내용이 있어야 다음 단계를 할 수 있는' 사용자 동작에서
 * 쓴다. 자동 동기화가 꺼져 있어도 동작하며, 실패는 호출자에게 그대로 던진다.
 */
export async function pushDeckNow(deck: Deck): Promise<Deck> {
  pending.delete(deck.id);
  waitingOnServer.delete(deck.id);
  backoff.reset(deck.id);
  await inFlight;
  const saved = await pusher(deck);
  listener?.(saved);
  failed.delete(deck.id);
  clearSyncFailure("deck", deck.id);
  if (pending.size === 0) setSyncStatus("deck", "synced");
  return saved;
}

/** 큐가 아직 끝내지 못한 곡 변경이 있는지 (보내는 중이거나 다시 시도할 것 포함) */
export function hasPendingDeckSync(): boolean {
  return pending.size > 0 || runningBatches.size > 0;
}

export function flushDeckSync(): Promise<void> {
  run();
  return inFlight;
}

/**
 * 부팅 동기화가 올리다 영구 실패로 남긴 곡을 맡긴다. 사용자가 '다시 시도'를 누르면
 * (`retryDeckSyncNow("manual")`) 큐가 다시 올린다.
 */
export function holdFailedDeckPush(deck: Deck): void {
  failed.set(deck.id, { kind: "push", deck });
}

/**
 * 연결 회복 신호(`syncRecovery`)에 맞춰 대기 중인 곡 변경을 곧바로 보낸다.
 *
 * `wake`는 서버가 거절해(5xx·429) 기다리는 곡만 백오프 타이머에 맡기고 나머지는 곧바로
 * 보낸다. 포커스마다 앞당기면 `Retry-After`를 어기고 서버 재시도 한도에 이르지 못한다.
 * 곡 변경끼리는 순서가 없으므로 오프라인으로 밀린 곡까지 함께 기다릴 까닭이 없다.
 * `reconnect`·`manual`은 백오프를 비우고 모두 보낸다(`syncScheduler`와 같다). 비우지
 * 않으면 '다시 시도' 뒤 한 번 더 실패한 곡이 지난 횟수 때문에 곧바로 영구 실패가 된다.
 * `manual`은 영구 실패로 남긴 곡 변경도 실패 기록을 지우고 다시 넣는다.
 */
export function retryDeckSyncNow(mode: SyncRetryMode): Promise<void> {
  if (mode === "manual") {
    for (const [key, op] of failed) {
      clearSyncFailure("deck", key);
      if (!pending.has(key)) pending.set(key, op);
    }
    failed = new Map();
  }
  if (mode !== "wake") backoff.reset();
  if (mode === "wake" && waitingOnServer.size > 0) {
    runNotWaitingOnServer();
    return inFlight;
  }
  return flushDeckSync();
}

export function __setDeckTransportForTests(next: {
  push?: DeckPusher;
  remove?: DeckDeleter;
}): void {
  pusher = next.push ?? pushDeck;
  deleter = next.remove ?? deleteDeckRemote;
}

export function __setDeckBackoffRandomForTests(fn: () => number): void {
  backoff.__setRandomForTests(fn);
}

export function __resetDeckSyncForTests(): void {
  enabled = false;
  pusher = pushDeck;
  deleter = deleteDeckRemote;
  listener = null;
  clearPending();
  inFlight = Promise.resolve();
  runningBatches.clear();
}
