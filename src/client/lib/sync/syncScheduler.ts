import type { Presentation } from "#shared";
import { pushPresentation, OfflineError } from "./presentationSync";
import { setSyncStatus } from "./syncStatus";
import { flushFolderSync } from "./folderSync";

/** 입력이 멈춘 뒤 이만큼 조용하면 올린다 */
export const SYNC_DEBOUNCE_MS = 3000;
/** 쉬지 않고 입력해도 첫 변경 뒤 이 시간 안에는 올린다 */
export const SYNC_MAX_WAIT_MS = 10_000;
/** 서로 다른 문서를 동시에 올리는 최대 개수 */
const PUSH_CONCURRENCY = 3;

type Pusher = (document: Presentation) => Promise<boolean>;

let pusher: Pusher = pushPresentation;
let enabled = false;
let pending = new Map<string, Presentation>();
let timer: ReturnType<typeof setTimeout> | null = null;
let deadline: number | null = null;
let inFlight: Promise<void> = Promise.resolve();

/** 로그인·하이드레이션이 끝난 뒤에만 켠다 */
export function setSyncEnabled(next: boolean): void {
  enabled = next;
  if (!next) clearPending();
}

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  deadline = null;
}

function clearPending(): void {
  pending = new Map();
  clearTimer();
}

async function pushAll(documents: Presentation[]): Promise<void> {
  if (documents.length === 0) return;

  await flushFolderSync();

  setSyncStatus("syncing");
  let offline = false;
  let failed = false;

  const queue = [...documents];
  const worker = async (): Promise<void> => {
    for (let document = queue.shift(); document; document = queue.shift()) {
      try {
        await pusher(document);
      } catch (err) {
        if (err instanceof OfflineError) {
          offline = true;
          if (!pending.has(document.id)) pending.set(document.id, document);
        } else {
          failed = true;
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, worker),
  );

  if (offline) {
    setSyncStatus("offline");
  } else if (failed) {
    setSyncStatus("error");
  } else {
    setSyncStatus("synced");
  }
}

function run(): void {
  clearTimer();
  if (pending.size === 0) return;

  const documents = [...pending.values()];
  pending = new Map();
  inFlight = inFlight.then(() => pushAll(documents));
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

  pending.set(document.id, document);
  const now = Date.now();
  deadline ??= now + SYNC_MAX_WAIT_MS;
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, Math.min(SYNC_DEBOUNCE_MS, deadline - now));
}

/**
 * 대기 중인 push 1건을 취소한다 (영구 삭제한 문서).
 * 이미 나간 요청은 되돌릴 수 없으므로 호출자는 `flushPendingSync()`로 기다린다.
 */
export function cancelDocumentPush(id: string): void {
  pending.delete(id);
}

export function flushPendingSync(): Promise<void> {
  run();
  return inFlight;
}

export function __setPusherForTests(next: Pusher | null): void {
  pusher = next ?? pushPresentation;
}

export function __resetSyncSchedulerForTests(): void {
  enabled = false;
  pusher = pushPresentation;
  clearPending();
  inFlight = Promise.resolve();
}
