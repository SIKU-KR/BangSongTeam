import type { Deck } from "#shared";
import {
  isRetryableApiError,
  isTransientServerError,
  requestIdOfError,
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import {
  pushDeck,
  deleteDeckRemote,
  syncFailureReasonOf,
} from "./presentationSync";
import {
  clearSyncFailure,
  recordSyncFailure,
  setSyncStatus,
  type SyncFailure,
} from "./syncStatus";
import {
  BackoffTracker,
  BASE_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  SLOW_RETRY_MS,
  type SyncRetryMode,
} from "./backoff";
import {
  forgetDeckDelete,
  listPendingDeckDeletes,
  rememberDeckDelete,
} from "./pendingDeckDeletes";
import { isProjecting } from "../../features/presentation/fullscreen";

const DECK_SYNC_DEBOUNCE_MS = 2000;

type DeckPusher = (deck: Deck) => Promise<Deck>;
type DeckDeleter = (id: string) => Promise<boolean | void>;
type ServerDeckListener = (deck: Deck) => void;
type DeckGoneListener = (id: string) => void;
type FailedDeckResolver = (id: string) => Deck | undefined;

type DeleteOp = { kind: "delete"; id: string; userId: string };
type PendingOp = { kind: "push"; deck: Deck } | DeleteOp;

let pusher: DeckPusher = pushDeck;
let deleter: DeckDeleter = deleteDeckRemote;
let listener: ServerDeckListener | null = null;
let goneListener: DeckGoneListener | null = null;
let resolveFailed: FailedDeckResolver | null = null;
let enabled = false;
let pending = new Map<string, PendingOp>();
let failed = new Map<string, PendingOp>();
const waitingDeletes = new Map<string, DeleteOp>();
const recordedDeletes = new Set<string>();
const waitingOnServer = new Map<string, number>();
const deletedIds = new Set<string>();
const deletedElsewhere = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let timerDueAt = Infinity;
let inFlight: Promise<void> = Promise.resolve();
const runningBatches = new Set<Promise<void>>();
const backoff = new BackoffTracker();

/**
 * 로그인·하이드레이션이 끝난 뒤에만 켠다 (송출 화면에서는 켜지 않는다).
 * 끄면 대기 중인 일은 버리지만 지운 곡 목록(`deletedDeckIds`)은 남긴다. id는 다시 쓰이지
 * 않으므로 남겨도 다른 곡을 가리지 않는다.
 *
 * 꺼져 있는 동안에는 보내는 중인 묶음의 남은 곡도, 끈 뒤에 끝난 요청이 다시 넣은 곡도 보내지
 * 않는다. 계정이 끝난 탭(`stopSync`)은 새로고침할 때까지 큐를 꺼 두고, 송출 중이면 송출을 마칠
 * 때까지 새로고침을 미룬다. 그사이 요청이 나가면 다른 계정의 쿠키로 간다.
 */
export function setDeckSyncEnabled(next: boolean): void {
  enabled = next;
  if (!next) clearPending();
}

export function setServerDeckListener(next: ServerDeckListener | null): void {
  listener = next;
}

/**
 * 큐가 올린 곡을 서버가 이미 지운 곡이라고 답하면(410) 그 id를 알린다. 다른 기기나 탭에서
 * 지운 곡이라, 받는 쪽은 DELETE를 다시 보내지 않고 보관함에서만 내려놓는다.
 */
export function setDeckGoneListener(next: DeckGoneListener | null): void {
  goneListener = next;
}

/**
 * '다시 시도'(`retryDeckSyncNow("manual")`)가 영구 실패로 남긴 곡 push 대신 다시 넣을 지금
 * 보관함의 곡을 찾을 곳을 등록한다. 부팅 동기화가 보관함을 등록하고 `stopSync`가 뗀다. 없다고
 * 답한 곡은 다시 넣지 않는다. 영구 실패한 삭제는 찾지 않고 삭제로 다시 보낸다.
 *
 * 실패로 남긴 사본은 실패한 때의 판이다. 그사이 부팅의 재시도 병합이 보관함을 서버의 새 사본으로
 * 바꿨으면, 그 사본을 다시 보내 서버의 새 곡을 옛 내용으로 덮는다.
 */
export function setFailedDeckResolver(next: FailedDeckResolver | null): void {
  resolveFailed = next;
}

/**
 * 서버가 이 계정에서 이미 지운 곡이라고 답했다(410). 실패가 아니라 삭제가 끝났다는 뜻이라
 * 실패로 남기지 않고 곡을 내려놓는다.
 */
export function isDeckDeletedError(err: unknown): boolean {
  return err instanceof ServerRejectedError && err.status === 410;
}

/**
 * 이 페이지에서 지웠거나 서버가 지운 곡이라고 답한 곡 id. 부팅 병합은 이 곡을 서버 목록에서
 * 받지도, 로컬에서 올리지도 않는다. DELETE가 닿기 전이나 닿은 직후에 받은 목록에는 지운 곡이
 * 아직 들어 있을 수 있다.
 */
export function deletedDeckIds(): ReadonlySet<string> {
  return deletedIds;
}

/** 이 페이지에서 지운 곡으로 아는지 (`deletedDeckIds` 참고) */
export function wasDeckDeleted(id: string): boolean {
  return deletedIds.has(id);
}

/**
 * DELETE를 보내지 않고 지운 곡으로만 기억한다. 다른 탭에서 지운 곡처럼 이 페이지가 서버에서
 * 지울 필요가 없는 곡에 쓴다. 이 페이지가 지웠거나 서버가 지웠다고 답한 곡이면 그 기억을 그대로
 * 둔다(`unmarkDeckDeleted` 참고).
 */
export function markDeckDeleted(id: string): void {
  if (!deletedIds.has(id)) deletedElsewhere.add(id);
  deletedIds.add(id);
}

/**
 * 다른 탭에서 지운 곡으로만 기억한 곡(`markDeckDeleted`)의 저장본이 다시 생겼을 때 그 기억을
 * 지운다. 지운 탭이 DELETE를 보내기 전에 같은 공유 곡을 다시 가져오면 같은 id로 돌아온다. 기억을
 * 남기면 이 페이지의 다음 보관함 병합이 다시 가져온 곡을 지운 곡으로 보고 저장소에서 지우고, 그
 * 알림을 받은 다른 탭도 곡을 뺀다.
 *
 * 이 페이지가 지웠거나(DELETE를 기다리거나 보내는 중이거나 이미 보냄) 서버가 지웠다고 답한
 * 곡(410)이면 기억을 그대로 두고 false를 돌려준다. 그 곡의 저장본은 늦게 끝난 다른 탭의 쓰기라
 * 보관함에 다시 넣으면 서버에서 지워진 곡이 이 페이지에만 남는다. 지운 곡으로 기억하지 않는(또는
 * 이번에 기억을 지운) 곡이면 true다.
 */
export function unmarkDeckDeleted(id: string): boolean {
  if (!deletedIds.has(id)) return true;
  if (!deletedElsewhere.has(id)) return false;
  deletedElsewhere.delete(id);
  deletedIds.delete(id);
  return true;
}

function resetDeckState(id: string): void {
  backoff.reset(id);
  waitingOnServer.delete(id);
  clearSyncFailure("deck", id);
}

function forgetDeletedDeck(id: string): void {
  deletedIds.add(id);
  deletedElsewhere.delete(id);
  if (pending.get(id)?.kind === "push") pending.delete(id);
  if (failed.get(id)?.kind === "push") failed.delete(id);
  resetDeckState(id);
}

function forgetRecordedDelete(op: DeleteOp): void {
  forgetDeckDelete(op.userId, op.id);
  recordedDeletes.delete(op.id);
}

function takeWaitingDelete(op: DeleteOp): boolean {
  if (waitingDeletes.get(op.id) !== op) return false;
  waitingDeletes.delete(op.id);
  return true;
}

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  timerDueAt = Infinity;
}

function runBy(dueAt: number): void {
  if (timer && timerDueAt <= dueAt) return;
  if (timer) clearTimeout(timer);
  timerDueAt = dueAt;
  timer = setTimeout(run, Math.max(0, dueAt - Date.now()));
}

function clearPending(): void {
  pending = new Map();
  failed = new Map();
  waitingDeletes.clear();
  recordedDeletes.clear();
  waitingOnServer.clear();
  clearTimer();
  backoff.reset();
}

function failureOf(op: PendingOp, key: string, err: unknown): SyncFailure {
  return {
    id: key,
    title: op.kind === "push" ? op.deck.title : undefined,
    kind: "deck",
    status: err instanceof ServerRejectedError ? err.status : undefined,
    message: err instanceof Error ? err.message : String(err),
    failedAt: Date.now(),
    requestId: requestIdOfError(err),
    reason: syncFailureReasonOf(err),
  };
}

async function runOps(ops: PendingOp[]): Promise<void> {
  if (ops.length === 0) return;

  setSyncStatus("deck", "syncing");
  let offline = false;
  let sessionExpired = false;
  let slowRetry = false;
  let deferred = false;
  let minRetryDelay = Infinity;

  for (const op of ops) {
    if (!enabled) return;
    const key = op.kind === "push" ? op.deck.id : op.id;
    if (op.kind === "delete" && !takeWaitingDelete(op)) continue;
    if (isProjecting()) {
      if (!pending.has(key)) pending.set(key, op);
      deferred = true;
      continue;
    }
    try {
      if (op.kind === "push") {
        const saved = await pusher(op.deck);
        if (deletedIds.has(key)) continue;
        listener?.(saved);
      } else {
        const removed = await deleter(op.id);
        if (removed !== false) forgetRecordedDelete(op);
      }
      backoff.reset(key);
      waitingOnServer.delete(key);
      failed.delete(key);
      clearSyncFailure("deck", key);
    } catch (err) {
      if (op.kind === "push" && deletedIds.has(key)) continue;
      if (op.kind === "push" && isDeckDeletedError(err)) {
        forgetDeletedDeck(key);
        goneListener?.(key);
        continue;
      }
      const expired = err instanceof SessionExpiredError;
      if (
        err instanceof OfflineError ||
        ((isRetryableApiError(err) || expired) &&
          backoff.getServerAttempt(key) < MAX_RETRY_ATTEMPTS)
      ) {
        if (expired) sessionExpired = true;
        else offline = true;
        const delay = backoff.getDelay(key, err);
        if (err instanceof ServerRejectedError || expired) {
          waitingOnServer.set(key, Date.now() + delay);
        } else {
          waitingOnServer.delete(key);
        }
        if (!pending.has(key)) pending.set(key, op);
        if (delay < minRetryDelay) minRetryDelay = delay;
      } else if (isTransientServerError(err)) {
        slowRetry = true;
        waitingOnServer.set(key, Date.now() + SLOW_RETRY_MS);
        if (!pending.has(key)) pending.set(key, op);
        if (SLOW_RETRY_MS < minRetryDelay) minRetryDelay = SLOW_RETRY_MS;
        recordSyncFailure(failureOf(op, key, err));
      } else {
        waitingOnServer.delete(key);
        backoff.reset(key);
        if (!pending.has(key)) failed.set(key, op);
        if (op.kind === "delete" && !expired) forgetRecordedDelete(op);
        const failure = failureOf(op, key, err);
        console.error("Deck push failed permanently", failure);
        recordSyncFailure(failure);
      }
    }
  }

  if (sessionExpired) {
    setSyncStatus("deck", "error");
  } else if (offline || waitingOnServer.size > 0) {
    setSyncStatus("deck", "offline");
  } else if (!deferred) {
    backoff.reset();
    setSyncStatus("deck", "synced");
  }
  if ((offline || sessionExpired || slowRetry) && minRetryDelay !== Infinity) {
    runBy(Date.now() + minRetryDelay);
  }
  if (deferred) runBy(Date.now() + BASE_BACKOFF_MS);
}

function startBatch(ops: PendingOp[]): void {
  for (const op of ops) {
    if (op.kind === "delete") waitingDeletes.set(op.id, op);
  }
  const batch = inFlight.then(() => runOps(ops));
  runningBatches.add(batch);
  inFlight = batch.finally(() => {
    runningBatches.delete(batch);
  });
}

function send(all: boolean): void {
  clearTimer();
  if (!enabled || pending.size === 0) return;
  if (isProjecting()) {
    runBy(Date.now() + BASE_BACKOFF_MS);
    return;
  }

  const now = Date.now();
  const ops: PendingOp[] = [];
  let nextWaitEnds = Infinity;
  for (const [key, op] of pending) {
    const waitEnds = waitingOnServer.get(key) ?? 0;
    if (!all && waitEnds > now) {
      nextWaitEnds = Math.min(nextWaitEnds, waitEnds);
      continue;
    }
    pending.delete(key);
    ops.push(op);
  }
  if (ops.length > 0) startBatch(ops);
  if (nextWaitEnds !== Infinity) runBy(nextWaitEnds);
}

function run(): void {
  send(false);
}

function schedule(key: string, op: PendingOp): void {
  if (!enabled) return;
  failed.delete(key);
  pending.set(key, op);
  clearTimer();
  runBy(Date.now() + DECK_SYNC_DEBOUNCE_MS);
}

/**
 * 같은 곡을 연달아 고치면 마지막 것만 올린다.
 *
 * 서버가 기다리라고 한 곡(5xx·429·401의 백오프와 `Retry-After`, 재시도 한도를 넘긴 느린 재시도)은 고쳐도
 * 그 대기가 끝난 뒤에 보내고, 다른 곡을 고쳐 디바운스 뒤에 보낼 때도 함께 보내지 않는다. 함께 보내면
 * 장애 중에 곡을 고칠 때마다 기다리던 곡을 모두 다시 보내 재시도 한도를 곧 다 쓰고, 느린 재시도가
 * 무른다.
 */
export function scheduleDeckPush(deck: Deck): void {
  schedule(deck.id, { kind: "push", deck });
}

/**
 * 대기 중인 push와 그 push의 실패 기록은 버린다 (지운 곡을 올릴 일은 없다).
 *
 * 동기화가 꺼져 있어도 지운 곡으로 기억한다(`deletedDeckIds`). 그 곡을 올리던 요청은 결과가
 * 와도 성공이든 실패든 버린다. push와 DELETE는 같은 키로 대기·백오프·실패 기록을 나눠 쓰므로,
 * push의 실패 처리가 대기 중인 DELETE를 지우거나 push를 다시 넣어 지운 곡을 되살린다.
 *
 * 무엇보다 먼저 `userId`의 삭제 기록(`pendingDeckDeletes`)에 남겨, 새로고침한 뒤에도 다시
 * 보낸다. 서버가 지웠다고 답하거나 다시 보내도 지울 수 없을 때(영구 실패)만 기록을 지운다.
 * 영구 실패에도 남기면 서버에 남은 곡이 이 기기에서만 끝내 가려진다. 404(다른 계정의 쿠키로
 * 보낸 요청)·세션 만료·오프라인·일시 장애는 기록을 남겨 그 계정의 다음 부팅에 다시 보낸다.
 * 세션 만료(401)는 재시도 한도를 넘겨 실패로 남아도 기록을 남긴다. 서버가 삭제를 거절한 것이
 * 아니라 이 탭의 로그인이 끝난 것이라, 그 계정으로 다시 로그인한 부팅이 지우면 된다.
 */
export function scheduleDeckDelete(id: string, userId: string): void {
  if (rememberDeckDelete(userId, id)) recordedDeletes.add(id);
  else recordedDeletes.delete(id);
  deletedIds.add(id);
  deletedElsewhere.delete(id);
  resetDeckState(id);
  schedule(id, { kind: "delete", id, userId });
}

/**
 * `userId`가 앞선 페이지에서 지우고 서버에서 아직 지우지 못한 곡의 DELETE를 다시 큐에 넣는다.
 * 부팅 동기화가 큐를 켜자마자 부른다. 보관함 목록을 받지 못한 부팅에서도 큐의 백오프로 다시
 * 보낸다.
 */
export function resumePendingDeckDeletes(userId: string): void {
  for (const id of listPendingDeckDeletes(userId)) {
    scheduleDeckDelete(id, userId);
  }
}

/**
 * 같은 브라우저의 다른 탭이 남긴 `userId`의 삭제 기록 가운데 이 페이지가 지운 적 없는 곡의 DELETE를
 * 이 페이지 큐에 넣는다. 연결 회복 신호(`syncRecovery`)마다 부른다. 큐가 꺼져 있으면 하지 않는다.
 *
 * DELETE는 지운 탭의 메모리 큐에만 있다. 그 탭이 오프라인에서 보내지 못한 채 닫히면, 열려 있는 탭은
 * 그 곡을 지운 곡으로 감추기만 하고 다음 부팅까지 아무도 보내지 않아 곡이 서버에 남는다. DELETE는 몇 번 받아도 결과가 같아, 아직 열려 있는 탭의 DELETE와 겹쳐도 된다. 이 페이지가
 * 지운 곡은 이 페이지 큐가 맡고 있거나, 서버가 이 계정의 곡이 아니라고 답해(404) 다음 부팅에 다시
 * 보낼 곡이라 넣지 않는다.
 */
export function resumeOtherTabsDeckDeletes(userId: string): void {
  if (!enabled) return;
  for (const id of listPendingDeckDeletes(userId)) {
    if (deletedIds.has(id) && !deletedElsewhere.has(id)) continue;
    scheduleDeckDelete(id, userId);
  }
}

function unsentDeleteOf(id: string): DeleteOp | undefined {
  for (const op of [pending.get(id), failed.get(id), waitingDeletes.get(id)]) {
    if (op?.kind === "delete") return op;
  }
  return undefined;
}

/**
 * 다른 탭이 이 페이지가 지운 곡을 다시 넣었으면 아직 보내지 않은 그 곡의 DELETE를 거두고 true를
 * 돌려준다. 다른 탭이 쓴 그 곡의 저장본을 다시 읽을 때(`reloadSongsFromStorage`) 부른다.
 *
 * 공유 곡을 다시 가져오면 서버는 남아 있는 첫 사본을 같은 id로 돌려주고, 다시 넣은 탭은 삭제 기록에서
 * 그 곡을 뺀다(`cancelDeckDelete`). 그 탭은 자기 큐만 거두므로 이 페이지의 DELETE가 나가면 다시
 * 가져온 곡이 서버에서 지워진다. 기다리거나, 다시 시도나 '다시 시도'를 기다리거나, 보내는 묶음에서
 * 차례를 기다리는 DELETE만 거둔다. 이미 보낸 DELETE는 서버가 지우므로 그대로 둔다.
 *
 * 이 페이지가 삭제 기록에 남긴 곡이 지금 기록에 없을 때만 다시 넣은 것으로 본다. 기록에 남아 있으면
 * 다른 탭의 늦은 쓰기다. 저장소를 쓸 수 없어 남기지 못했거나 영구 실패로 이 페이지가 기록을 지웠으면,
 * 기록이 없다는 것만으로는 다시 넣었는지 알 수 없어 거두지 않는다.
 */
export function cancelDeckDeleteReaddedElsewhere(id: string): boolean {
  const op = unsentDeleteOf(id);
  if (!op || !recordedDeletes.has(id)) return false;
  if (listPendingDeckDeletes(op.userId).includes(id)) return false;
  cancelDeckDelete(id, op.userId);
  return true;
}

/**
 * 대기 중이거나 영구 실패로 맡긴 그 곡의 push를 버린다 (부팅 병합에서 서버 사본이 이겼거나
 * 지워진 곡). 남겨 두면 연결이 돌아올 때 옛 사본이 서버의 새 사본을 덮거나 지운 곡을 되살린다.
 *
 * 그 곡의 DELETE가 대기 중이거나 실패로 남아 있으면 건드리지 않는다. 같은 키의 대기·백오프·
 * 실패 기록을 비우면 서버가 기다리라고 한 DELETE가 일찍 나가거나 DELETE 실패가 가려진다.
 */
export function cancelDeckPush(id: string): void {
  const queued = pending.get(id);
  const held = failed.get(id);
  if (queued?.kind !== "push" && held?.kind !== "push") return;
  if (queued?.kind === "push") pending.delete(id);
  if (held?.kind === "push") failed.delete(id);
  resetDeckState(id);
}

/**
 * 아직 보내지 않았거나 영구 실패로 맡긴 그 곡의 DELETE를 버리고 지운 곡 목록과 `userId`의
 * 삭제 기록에서 뺀다. 보내는 묶음에서 앞 곡을 기다리는 DELETE도 차례가 와도 보내지 않는다. 지운
 * 곡을 다시 넣을 때 부른다. 공유 곡을 다시 가져오면 서버는 남아 있는 첫 사본을 돌려주므로,
 * DELETE가 뒤늦게 나가면 다시 가져온 곡이 서버에서 지워진다.
 */
export function cancelDeckDelete(id: string, userId: string): void {
  forgetDeckDelete(userId, id);
  recordedDeletes.delete(id);
  deletedIds.delete(id);
  deletedElsewhere.delete(id);
  const waiting = waitingDeletes.delete(id);
  const queued = pending.get(id);
  const held = failed.get(id);
  if (queued?.kind !== "delete" && held?.kind !== "delete" && !waiting) return;
  if (queued?.kind === "delete") pending.delete(id);
  if (held?.kind === "delete") failed.delete(id);
  resetDeckState(id);
}

/**
 * 곡 1건을 지금 바로 올리고 서버가 확정한 덱을 돌려준다.
 *
 * 공개 전환처럼 '서버에 이 내용이 있어야 다음 단계를 할 수 있는' 사용자 동작에서
 * 쓴다. 자동 동기화가 꺼져 있어도 동작하며, 실패는 호출자에게 그대로 던진다.
 *
 * 서버가 이미 지운 곡이라고 답하면(410) 지운 곡으로 기억하고 남은 push를 버린 뒤 그대로
 * 던진다. 큐가 꺼진 화면(송출 주소로 연 탭)에서도 불리므로 곡은 호출자가 내려놓는다.
 * 보내는 동안 사용자가 지운 곡이면 응답을 보관함에 넘기지 않는다.
 */
export async function pushDeckNow(deck: Deck): Promise<Deck> {
  if (pending.get(deck.id)?.kind !== "delete") {
    pending.delete(deck.id);
    waitingOnServer.delete(deck.id);
    backoff.reset(deck.id);
  }
  await inFlight;
  const saved = await pusher(deck).catch((err: unknown) => {
    if (isDeckDeletedError(err) && !deletedIds.has(deck.id)) {
      forgetDeletedDeck(deck.id);
    }
    throw err;
  });
  if (deletedIds.has(deck.id)) return saved;
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

/**
 * 서버에 아직 올리거나 지우지 못한 곡 변경이 있는지. `hasPendingDeckSync`가 세는 것에 더해, 영구
 * 실패로 맡아 '다시 시도'를 기다리는 변경과 기다리는 삭제도 센다. 새로고침해 큐가 비어도 남는
 * 삭제 기록은 `listPendingDeckDeletes`로 따로 본다.
 */
export function hasUnsentDecks(): boolean {
  return (
    pending.size > 0 ||
    runningBatches.size > 0 ||
    failed.size > 0 ||
    waitingDeletes.size > 0
  );
}

/**
 * 대기 중인 곡 변경을 디바운스·백오프를 기다리지 않고 지금 보내고, 큐가 끝날 때까지 기다린다.
 * 창을 닫을 때(`pagehide`)와 로그아웃하기 전에 부른다.
 *
 * 송출 중에는 묶음을 새로 보내지 않고 이미 나간 것이 끝나기만 기다린다. 송출 화면은 서버 요청이
 * 0건이어야 한다. 송출 전에 보내기 시작한 묶음도 송출을 시작하면 남은 곡 변경을 보내지 않고 큐에
 * 되돌린다. 디바운스·백오프와 재시도 한도를 넘긴 느린 재시도(`SLOW_RETRY_MS`)도 송출하는
 * 동안은 몇 초마다 다시 보기만 하고, 송출을 마치면 남은 곡 변경을 보낸다. 지운 곡은 삭제
 * 기록(`pendingDeckDeletes`)에, 고친 곡은 저장소에 남아 있어 탭을 닫아도 다음 부팅이 보낸다.
 */
export function flushDeckSync(): Promise<void> {
  send(true);
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
 * `wake`는 서버가 거절해(5xx·429·401) 기다리는 곡만 백오프 타이머에 맡기고 나머지는 곧바로
 * 보낸다. 포커스마다 앞당기면 `Retry-After`를 어기고 서버 재시도 한도에 이르지 못한다.
 * 곡 변경끼리는 순서가 없으므로 오프라인으로 밀린 곡까지 함께 기다릴 까닭이 없다.
 * `reconnect`·`manual`은 백오프를 비우고 모두 보낸다(`syncScheduler`와 같다). 비우지
 * 않으면 '다시 시도' 뒤 한 번 더 실패한 곡이 지난 횟수 때문에 곧바로 영구 실패가 된다.
 * `manual`은 영구 실패로 남긴 곡 변경도 다시 넣고, 다시 보내는 곡 변경의 실패 기록을 지운다.
 * 재시도 한도를 넘겨 `SLOW_RETRY_MS`마다 다시 보내던 곡 변경도 곧바로 보낸다. 곡 push는 실패한
 * 사본이 아니라 지금 보관함의 곡을 넣고(`setFailedDeckResolver`), 그사이 없어진 곡은 버린다. 다시
 * 넣는 DELETE는 영구 실패 때 지운 삭제 기록(`pendingDeckDeletes`)에도 다시 남긴다. 사용자가 다시
 * 지우겠다고 한 것이라, 이번에 오프라인으로 밀린 채 탭을 닫아도 다음 부팅이 다시 보낸다.
 *
 * 송출 중에는 어느 모드든 보내지 않고 송출을 마친 뒤 큐가 보낸다(`flushDeckSync`와 같다).
 */
export function retryDeckSyncNow(mode: SyncRetryMode): Promise<void> {
  if (mode === "manual") {
    for (const key of pending.keys()) clearSyncFailure("deck", key);
    requeueFailedOps();
  }
  if (mode !== "wake") backoff.reset();
  send(mode !== "wake");
  return inFlight;
}

function currentOpOf(op: PendingOp): PendingOp | null {
  if (op.kind === "delete" || !resolveFailed) return op;
  const deck = resolveFailed(op.deck.id);
  return deck ? { kind: "push", deck } : null;
}

function requeueFailedOps(): void {
  for (const [key, op] of failed) {
    clearSyncFailure("deck", key);
    if (pending.has(key)) continue;
    const current = currentOpOf(op);
    if (!current) continue;
    pending.set(key, current);
    if (
      current.kind === "delete" &&
      rememberDeckDelete(current.userId, current.id)
    ) {
      recordedDeletes.add(current.id);
    }
  }
  failed = new Map();
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
  goneListener = null;
  resolveFailed = null;
  deletedIds.clear();
  deletedElsewhere.clear();
  clearPending();
  inFlight = Promise.resolve();
  runningBatches.clear();
}
