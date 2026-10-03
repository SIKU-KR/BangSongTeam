import { registerSW } from "virtual:pwa-register";

/** vite-plugin-pwa의 `registerSW` 시그니처 (테스트 주입용) */
export type ServiceWorkerRegistrar = (options: {
  onNeedReload?: () => void;
  onRegisteredSW?: (
    swUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void;
  onRegisterError?: (error: unknown) => void;
}) => (reloadPage?: boolean) => Promise<void>;

let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registered = false;
let updateRequestedAt: number | null = null;
let stopUpdateChecks: (() => void) | null = null;

const PROJECTION_PATH = /^\/present\//;
const UNCONTROLLED_RELOAD_KEY = "sw-uncontrolled-reload";
const STALE_CHUNK_RELOAD_KEY = "sw-stale-chunk-reload";
const STALE_CHUNK_RELOAD_INTERVAL_MS = 60_000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;
const APPLY_RELOAD_DEADLINE_MS = 5_000;

function isProjectionPath(): boolean {
  return PROJECTION_PATH.test(window.location.pathname);
}

function applyIfWaiting(registration: ServiceWorkerRegistration): void {
  if (!registration.waiting || isProjectionPath() || !applyUpdate) return;
  updateRequestedAt = Date.now();
  void applyUpdate(true);
}

function startUpdateChecks(registration: ServiceWorkerRegistration): void {
  stopUpdateChecks?.();
  const check = (): void => {
    if (isProjectionPath()) return;
    registration.update().catch(() => undefined);
  };
  const checkWhenVisible = (): void => {
    if (document.visibilityState === "visible") check();
  };
  const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", checkWhenVisible);
  stopUpdateChecks = () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", checkWhenVisible);
  };
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

/**
 * Service Worker 등록과 갱신.
 *
 * **새 버전은 사용자가 새로고침할 때 적용한다.** 배포가 나간 순간 송출 중인 창이
 * 새로고침되면 예배가 끊기므로 실행 중인 탭은 절대 스스로 새로고침하지 않는다.
 *
 * 평범한 새로고침은 대기 중인 SW를 활성화하지 않는다. 새로 열린 페이지도 옛 SW가
 * 제어하고 옛 프리캐시의 셸을 받는다. 그래서 등록을 마친 순간 대기 중인 SW가 있으면
 * skip-waiting을 보내고, 제어가 넘어오면 그 탭만 한 번 더 새로고침한다. 판단은 등록
 * 직후 한 번뿐이다. 그 뒤에 발견한 버전은 쓰고 있는 화면을 갑자기 새로고침하게 되므로
 * 다음 새로고침으로 미룬다. 옛 SW에 끝나지 않은 요청이 남아 있으면 브라우저가 활성화를
 * 미뤄 제어가 수십 초 뒤에 넘어오기도 한다. 그때는 이미 화면을 쓰고 있을 수 있으므로
 * 요청 후 5초 안에 넘어온 경우에만 새로고침하고, 늦게 넘어오면 다음 새로고침에 맡긴다. 열어 둔 탭이 배포를 미리 발견해 두도록 주기적으로, 그리고
 * 탭이 다시 보일 때 갱신을 확인한다.
 *
 * 송출 경로(`/present/...`)는 새로고침해도 적용하지 않고, 예배 중 새 버전을 내려받지
 * 않도록 갱신 확인도 건너뛴다.
 *
 * 새 SW가 제어를 넘겨받으면 같은 출처의 모든 탭에 `controllerchange`가 오는데,
 * `onNeedReload`를 넘기지 않으면 workbox-window가 모든 탭을 새로고침하므로 적용을
 * 요청한 탭만 새로고침한다. 새로고침하지 않은 탭은 옛 코드로 남고, 지워진 옛 청크는
 * `reloadOnStaleChunk`가 다룬다.
 */
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
    onNeedReload: () => {
      const requestedAt = updateRequestedAt;
      updateRequestedAt = null;
      if (requestedAt === null || isProjectionPath()) return;
      if (Date.now() - requestedAt < APPLY_RELOAD_DEADLINE_MS) {
        window.location.reload();
      }
    },
    onRegisteredSW: (_swUrl, registration) => {
      if (!registration) return;
      applyIfWaiting(registration);
      startUpdateChecks(registration);
    },
    onRegisterError: () => {
      registered = false;
    },
  });
  void reloadIfUncontrolled();
}

export function __resetServiceWorkerStateForTests(): void {
  applyUpdate = null;
  registered = false;
  updateRequestedAt = null;
  stopUpdateChecks?.();
  stopUpdateChecks = null;
  window.removeEventListener("vite:preloadError", reloadOnStaleChunk);
}
