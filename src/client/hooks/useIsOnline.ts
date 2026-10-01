import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

const getSnapshot = (): boolean => navigator.onLine;

/**
 * 브라우저가 네트워크에 연결되어 있다고 보는지.
 *
 * `navigator.onLine === true`가 '서버에 닿는다'를 보장하지는 않는다. 그래서 요청
 * 실패는 `lib/api/request`의 `callApi`가 `OfflineError`로 따로 가르고, 동기화
 * 경로는 그것을 감싸 상태 배지를 남긴다. 이 값은 '확실히 끊겼으니 시도조차 하지
 * 않는다' 판단에만 쓴다.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
