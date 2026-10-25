import { Workbox } from "workbox-window";
import type { ServiceWorkerRegistrar } from "./registerServiceWorker";

/** `scripts/buildServiceWorker.mjs`가 `public/`에 만드는 서비스 워커 */
export const SERVICE_WORKER_URL = "/sw.js";

/**
 * workbox-window로 서비스 워커를 등록한다. 대기 중인 새 버전은 돌려준 함수를 불러야
 * 활성화한다(`SKIP_WAITING` 메시지). 새 버전이 제어를 넘겨받으면 `onNeedReload`를 부른다.
 */
export const registerWithWorkbox: ServiceWorkerRegistrar = ({
  onNeedReload,
  onRegisteredSW,
  onRegisterError,
}) => {
  const workbox = new Workbox(SERVICE_WORKER_URL, { scope: "/" });
  workbox.addEventListener("controlling", (event) => {
    if (event.isUpdate) onNeedReload?.();
  });
  workbox
    .register({ immediate: true })
    .then((registration) => onRegisteredSW?.(SERVICE_WORKER_URL, registration))
    .catch((error: unknown) => onRegisterError?.(error));

  return async () => {
    workbox.messageSkipWaiting();
  };
};
