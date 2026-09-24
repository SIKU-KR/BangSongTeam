import type { Deck } from "@repo/shared";
import { pushDeck, deleteDeckRemote, OfflineError } from "./presentationSync";
import { setSyncStatus } from "./syncStatus";

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
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

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
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function runOps(ops: PendingOp[]): Promise<void> {
  if (ops.length === 0) return;

  setSyncStatus("syncing");
  let offline = false;
  let failed = false;

  for (const op of ops) {
    try {
      if (op.kind === "push") {
        const saved = await pusher(op.deck);
        listener?.(saved);
      } else {
        await deleter(op.id);
      }
    } catch (err) {
      if (err instanceof OfflineError) {
        offline = true;
        const key = op.kind === "push" ? op.deck.id : op.id;
        if (!pending.has(key)) pending.set(key, op);
      } else {
        failed = true;
      }
    }
  }

  if (offline) setSyncStatus("offline");
  else if (failed) setSyncStatus("error");
  else setSyncStatus("synced");
}

function run(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return;

  const ops = [...pending.values()];
  pending = new Map();
  inFlight = inFlight.then(() => runOps(ops));
}

function schedule(key: string, op: PendingOp): void {
  if (!enabled) return;
  pending.set(key, op);
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DECK_SYNC_DEBOUNCE_MS);
}

/** 같은 곡을 연달아 고치면 마지막 것만 올린다 */
export function scheduleDeckPush(deck: Deck): void {
  schedule(deck.id, { kind: "push", deck });
}

/** 대기 중인 push는 버린다 */
export function scheduleDeckDelete(id: string): void {
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
  await inFlight;
  const saved = await pusher(deck);
  listener?.(saved);
  setSyncStatus("synced");
  return saved;
}

export function flushDeckSync(): Promise<void> {
  run();
  return inFlight;
}

export function __setDeckTransportForTests(next: {
  push?: DeckPusher;
  remove?: DeckDeleter;
}): void {
  pusher = next.push ?? pushDeck;
  deleter = next.remove ?? deleteDeckRemote;
}

export function __resetDeckSyncForTests(): void {
  enabled = false;
  pusher = pushDeck;
  deleter = deleteDeckRemote;
  listener = null;
  clearPending();
  inFlight = Promise.resolve();
}
