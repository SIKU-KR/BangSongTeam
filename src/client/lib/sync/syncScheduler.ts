import type { Presentation } from "#shared";
import { pushPresentation, OfflineError } from "./presentationSync";
import { setSyncStatus } from "./syncStatus";
import { flushFolderSync } from "./folderSync";

const SYNC_DEBOUNCE_MS = 2000;

type Pusher = (document: Presentation) => Promise<boolean>;

let pusher: Pusher = pushPresentation;
let enabled = false;
let pending = new Map<string, Presentation>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

/** 로그인·하이드레이션이 끝난 뒤에만 켠다 */
export function setSyncEnabled(next: boolean): void {
  enabled = next;
  if (!next) clearPending();
}

function clearPending(): void {
  pending = new Map();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function pushAll(documents: Presentation[]): Promise<void> {
  if (documents.length === 0) return;

  await flushFolderSync();

  setSyncStatus("syncing");
  let offline = false;
  let failed = false;

  for (const document of documents) {
    try {
      await pusher(document);
    } catch (err) {
      if (err instanceof OfflineError) {
        offline = true;
        pending.set(document.id, document);
      } else {
        failed = true;
      }
    }
  }

  if (offline) {
    setSyncStatus("offline");
  } else if (failed) {
    setSyncStatus("error");
  } else {
    setSyncStatus("synced");
  }
}

function run(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
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
 */
export function scheduleDocumentPush(document: Presentation): void {
  if (!enabled) return;
  if (!document.id) return;
  if (document.access) return;

  pending.set(document.id, document);
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, SYNC_DEBOUNCE_MS);
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
