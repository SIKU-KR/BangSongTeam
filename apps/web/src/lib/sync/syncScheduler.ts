import type { Presentation } from "@repo/shared";
import { pushPresentation, OfflineError } from "./presentationSync";
import { setSyncStatus } from "./syncStatus";

/**
 * 서버 push 스케줄러.
 *
 * IndexedDB 저장(300ms)과 **큐도 in-flight 체인도 완전히 분리한다.** 느린
 * 네트워크가 로컬 저장을 막으면 안 되기 때문이다. 디바운스를 더 길게 잡는 것은
 * 네트워크 왕복을 줄이기 위함이고, 로컬 저장은 이미 끝나 있으므로 여기서
 * 조금 늦어져도 작업이 사라지지 않는다.
 */
const SYNC_DEBOUNCE_MS = 2000;

/**
 * 실제 전송 함수. 테스트에서 갈아 끼운다.
 *
 * `vi.spyOn`으로 ES 모듈 함수 export를 바꿀 수 없어 주입식으로 둔다
 * (세션 스토어와 같은 방식).
 */
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

  setSyncStatus("syncing");
  let offline = false;
  let failed = false;

  for (const document of documents) {
    try {
      await pusher(document);
    } catch (err) {
      if (err instanceof OfflineError) {
        offline = true;
        // 오프라인이면 남은 문서도 어차피 실패한다. 다시 큐에 넣어 둔다.
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

  pending.set(document.id, document);
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, SYNC_DEBOUNCE_MS);
}

/** 대기 중인 push를 즉시 시작하고 완료를 기다린다 */
export function flushPendingSync(): Promise<void> {
  run();
  return inFlight;
}

/** 테스트 전용: 전송 함수를 갈아 끼운다 */
export function __setPusherForTests(next: Pusher | null): void {
  pusher = next ?? pushPresentation;
}

/** 테스트 전용 */
export function __resetSyncSchedulerForTests(): void {
  enabled = false;
  pusher = pushPresentation;
  clearPending();
  inFlight = Promise.resolve();
}
