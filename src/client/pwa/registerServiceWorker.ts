import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

/**
 * Service Worker 등록과 갱신 상태.
 *
 * **자동 새로고침을 하지 않는다.** `registerType: "prompt"`를 쓰는 이유와 같다 —
 * 배포가 나간 순간 송출 중인 창이 새로고침되면 예배가 끊긴다. 새 버전이 대기
 * 중이라는 사실만 알리고, 적용 시점은 사용자가 편집 화면에서 고른다.
 *
 * 새 SW가 제어를 넘겨받으면 같은 출처의 모든 탭에 `controllerchange`가 온다.
 * `onNeedReload`를 넘기지 않으면 workbox-window가 그때마다 모든 탭을 새로고침하므로,
 * 다른 탭에서 적용을 눌러도 송출 중인 창이 새로고침된다. 그래서 적용을 요청한 탭만,
 * 그 탭이 송출 화면이 아닐 때만 새로고침한다. 새로고침하지 않은 탭은 옛 코드로 남으므로
 * 그 탭의 적용 버튼은 새로고침만 하고, 지워진 옛 청크를 못 받으면 송출 화면이 아닐 때
 * 한 번 새로고침해 새 버전으로 넘어간다.
 */
interface ServiceWorkerState {
  needRefresh: boolean;
}

/** vite-plugin-pwa의 `registerSW` 시그니처 (테스트 주입용) */
export type ServiceWorkerRegistrar = (options: {
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
  onRegisterError?: (error: unknown) => void;
}) => (reloadPage?: boolean) => Promise<void>;

const INITIAL: ServiceWorkerState = { needRefresh: false };

let state: ServiceWorkerState = INITIAL;
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registered = false;
let updateRequestedHere = false;
let controllerReplaced = false;

const PROJECTION_PATH = /^\/present\//;
const UNCONTROLLED_RELOAD_KEY = "sw-uncontrolled-reload";
const STALE_CHUNK_RELOAD_KEY = "sw-stale-chunk-reload";
const STALE_CHUNK_RELOAD_INTERVAL_MS = 60_000;

const listeners = new Set<() => void>();

function setState(next: ServiceWorkerState): void {
  if (next.needRefresh === state.needRefresh) return;
  state = next;
  for (const listener of listeners) listener();
}

function isProjectionPath(): boolean {
  return PROJECTION_PATH.test(window.location.pathname);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getServiceWorkerState(): ServiceWorkerState {
  return state;
}

/** 새 버전 대기 여부를 반응형으로 구독한다 (갱신 배너용) */
export function useServiceWorkerState(): ServiceWorkerState {
  return useSyncExternalStore(
    subscribe,
    getServiceWorkerState,
    getServiceWorkerState,
  );
}

/**
 * 대기 중인 새 버전을 적용한다. 사용자가 버튼을 눌렀을 때만 호출된다.
 *
 * 여기서 바로 새로고침하지 않는다. 새 SW가 제어를 넘겨받기 전에 새로고침하면 옛 SW의
 * 캐시된 셸이 다시 뜬다. 이 탭이 요청했다는 표시만 남기고, 제어가 넘어온 뒤
 * `onNeedReload`에서 이 탭만 새로고침한다.
 *
 * 다른 탭이 먼저 적용해 새 SW가 이미 제어하면 대기 중인 SW가 없어 skip-waiting 메시지가
 * 나가지 않고 `onNeedReload`도 다시 오지 않는다. 그때는 곧바로 새로고침해야 배너가
 * 사라진다.
 */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (controllerReplaced) {
    if (!isProjectionPath()) window.location.reload();
    return;
  }
  if (!applyUpdate) return;
  updateRequestedHere = true;
  await applyUpdate(true);
}

/**
 * 지워진 옛 청크를 불러오지 못했을 때(`vite:preloadError`) 새 버전으로 새로고침한다.
 *
 * 다른 탭이 새 버전을 적용하면 새 SW가 옛 프리캐시를 지우고, 새 배포 서버에도 옛 해시
 * 청크가 없다. 새로고침하지 않고 남은 탭은 지연 로드 화면으로 이동할 때 오류 화면에
 * 걸린다. 송출 화면에서는 전체 화면이 풀리므로 새로고침하지 않는다. 1분 안에 다시
 * 실패하면 새로고침하지 않아 무한 새로고침이 생기지 않고, sessionStorage를 쓸 수 없으면
 * 새로고침하지 않는다.
 */
export function reloadOnStaleChunk(): void {
  try {
    if (isProjectionPath()) return;
    const last = Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY));
    const now = Date.now();
    if (now - last < STALE_CHUNK_RELOAD_INTERVAL_MS) return;
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
    window.location.reload();
  } catch {
    return;
  }
}

/**
 * 강력 새로고침(Ctrl+F5, Shift+새로고침)으로 SW 제어 없이 열린 페이지를 한 번만
 * 다시 불러 SW가 제어하게 한다.
 *
 * 제어받지 않는 페이지는 Cache API에 영상이 있어도 `<video>` 요청이 SW를 거치지 않아,
 * 나중에 네트워크가 끊기면 배경이 나오지 않는다. 부팅 직후에는 아직 아무것도 그리지
 * 않았고 전체 화면도 아니라 새로고침의 비용이 로딩 화면 한 번이다.
 *
 * - 송출 경로(`/present/...`)에서는 절대 새로고침하지 않는다. 전체 화면이 풀리고
 *   청중 화면이 깜빡인다.
 * - 오프라인이면 새로고침이 오류 페이지로 끝날 수 있어 건너뛴다.
 * - 같은 탭에서 한 번만 한다. sessionStorage 표시가 이미 있거나 sessionStorage를 쓸 수
 *   없으면 새로고침하지 않아 무한 새로고침이 생기지 않는다. 제어받는 페이지가 뜨면
 *   표시를 지워 다음 강력 새로고침도 다시 고친다.
 */
export async function reloadIfUncontrolled(): Promise<void> {
  try {
    if (isProjectionPath()) return;
    const container = navigator.serviceWorker;
    if (container.controller) {
      sessionStorage.removeItem(UNCONTROLLED_RELOAD_KEY);
      return;
    }
    if (!navigator.onLine) return;
    const registration = await container.getRegistration();
    if (!registration?.active || isProjectionPath()) return;
    if (sessionStorage.getItem(UNCONTROLLED_RELOAD_KEY) !== null) return;
    sessionStorage.setItem(UNCONTROLLED_RELOAD_KEY, "1");
    window.location.reload();
  } catch {
    return;
  }
}

export function registerServiceWorker(
  registrar: ServiceWorkerRegistrar = registerSW,
): void {
  if (registered) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  registered = true;
  window.addEventListener("vite:preloadError", reloadOnStaleChunk);

  applyUpdate = registrar({
    onNeedRefresh: () => {
      controllerReplaced = false;
      setState({ ...state, needRefresh: true });
    },
    onNeedReload: () => {
      if (updateRequestedHere && !isProjectionPath()) {
        window.location.reload();
        return;
      }
      updateRequestedHere = false;
      controllerReplaced = true;
    },
    onRegisterError: () => {
      registered = false;
    },
  });
  void reloadIfUncontrolled();
}

export function __resetServiceWorkerStateForTests(): void {
  state = INITIAL;
  applyUpdate = null;
  registered = false;
  updateRequestedHere = false;
  controllerReplaced = false;
  window.removeEventListener("vite:preloadError", reloadOnStaleChunk);
  listeners.clear();
}
