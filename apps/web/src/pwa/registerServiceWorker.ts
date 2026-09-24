import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

/**
 * Service Worker 등록과 갱신 상태.
 *
 * **자동 새로고침을 하지 않는다.** `registerType: "prompt"`를 쓰는 이유와 같다 —
 * 배포가 나간 순간 송출 중인 창이 새로고침되면 예배가 끊긴다. 새 버전이 대기
 * 중이라는 사실만 알리고, 적용 시점은 사용자가 편집 화면에서 고른다.
 */
export interface ServiceWorkerState {
  needRefresh: boolean;
  offlineReady: boolean;
}

/** vite-plugin-pwa의 `registerSW` 시그니처 (테스트 주입용) */
export type ServiceWorkerRegistrar = (options: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: (error: unknown) => void;
}) => (reloadPage?: boolean) => Promise<void>;

const INITIAL: ServiceWorkerState = { needRefresh: false, offlineReady: false };

let state: ServiceWorkerState = INITIAL;
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registered = false;

const listeners = new Set<() => void>();

function setState(next: ServiceWorkerState): void {
  if (
    next.needRefresh === state.needRefresh &&
    next.offlineReady === state.offlineReady
  ) {
    return;
  }
  state = next;
  for (const listener of listeners) listener();
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
 * 대기 중인 새 버전을 적용하고 페이지를 새로고침한다.
 * 사용자가 버튼을 눌렀을 때만 호출된다.
 */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!applyUpdate) return;
  await applyUpdate(true);
}

/** Service Worker를 등록한다. */
export function registerServiceWorker(
  registrar: ServiceWorkerRegistrar = registerSW,
): void {
  if (registered) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  registered = true;

  applyUpdate = registrar({
    onNeedRefresh: () => {
      setState({ ...state, needRefresh: true });
    },
    onOfflineReady: () => {
      setState({ ...state, offlineReady: true });
    },
    onRegisterError: () => {
      registered = false;
    },
  });
}

/** 테스트 전용 초기화 */
export function __resetServiceWorkerStateForTests(): void {
  state = INITIAL;
  applyUpdate = null;
  registered = false;
  listeners.clear();
}
