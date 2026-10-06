function initialReachable(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

let reachable = initialReachable();
const listeners = new Set<() => void>();

function setReachable(next: boolean): void {
  if (reachable === next) return;
  reachable = next;
  for (const listener of listeners) listener();
}

/** 서버가 응답했다 (상태 코드와 상관없이 닿았다) */
export function markServerReachable(): void {
  setReachable(true);
}

/** 네트워크 실패나 타임아웃으로 서버에 닿지 못했다 */
export function markServerUnreachable(): void {
  setReachable(false);
}

/**
 * 서버에 닿는지. 마지막 실제 요청 결과를 기준으로 삼는다.
 *
 * `navigator.onLine === true`는 서버에 닿는다는 보장이 아니다 (MDN). 캡티브 포털,
 * 멈춘 Wi‑Fi, 죽은 HTTP/2 연결에서는 `online` 이벤트가 오지 않아 큐가 다시 돌지
 * 않는다. 그래서 `callApi`가 응답을 받으면 닿음, 네트워크 실패·타임아웃이면 닿지
 * 못함으로 남기고, 동기화 회복(`syncRecovery`)이 이 값의 변화를 보고 움직인다.
 * 처음 값만 `navigator.onLine`을 따른다. `false`일 때는 확실히 닿지 못하기 때문이다.
 *
 * 이 모듈은 다른 모듈을 가져오지 않는다. `callApi`가 이것을 쓰므로, 여기서 동기화
 * 모듈을 가져오면 api → sync 순환이 생긴다.
 */
export function isServerReachable(): boolean {
  return reachable;
}

/** 값이 실제로 바뀔 때만 알린다 */
export function subscribeServerReachability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetConnectivityForTests(): void {
  reachable = initialReachable();
  listeners.clear();
}
