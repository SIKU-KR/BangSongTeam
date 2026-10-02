import { useCallback, useEffect, useRef } from "react";

const SENTINEL_FLAG = "projectionHistoryGuard";
const RELEASE_TIMEOUT_MS = 1000;

function isSentinelState(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[SENTINEL_FLAG] === true
  );
}

function pushSentinel(): void {
  const state: unknown = window.history.state;
  const base = typeof state === "object" && state !== null ? state : {};
  window.history.pushState(
    { ...base, [SENTINEL_FLAG]: true },
    "",
    window.location.href,
  );
}

function waitForPopState(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      window.removeEventListener("popstate", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, RELEASE_TIMEOUT_MS);
    window.addEventListener("popstate", done);
  });
}

/**
 * 송출 중 뒤로 가기(마우스 뒤로 버튼, 트랙패드 스와이프, 브라우저 버튼)로 송출 화면을
 * 떠나지 않게 한다.
 *
 * 지금 항목 위에 같은 주소·같은 라우터 state(idx·key)의 보초 항목을 하나 쌓아, 뒤로 가기가
 * 같은 송출 라우트로 돌아오게 하고(다시 마운트되지 않는다) 곧바로 보초를 다시 쌓는다.
 * 보초는 표시해 두어 StrictMode 재실행이나 새로고침에서 겹쳐 쌓이지 않는다.
 * 가로 오버스크롤 제스처도 막는다.
 *
 * 돌려주는 `release`는 송출을 끝낼 때 부른다. 가드를 풀고 보초 항목을 걷어 내므로, 이어서
 * replace로 이동하면 송출 항목이 history에 남지 않아 뒤로 가기로 송출이 다시 열리지 않는다.
 */
export function useProjectionHistoryGuard(): () => Promise<void> {
  const releasedRef = useRef(false);
  const unsubscribeRef = useRef<() => void>(() => {});

  useEffect(() => {
    releasedRef.current = false;
    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = "none";

    const pinnedPath = window.location.pathname;
    if (!isSentinelState(window.history.state)) pushSentinel();

    const handlePopState = (): void => {
      if (releasedRef.current) return;
      if (window.location.pathname !== pinnedPath) return;
      if (!isSentinelState(window.history.state)) pushSentinel();
    };
    window.addEventListener("popstate", handlePopState);
    unsubscribeRef.current = () =>
      window.removeEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      root.style.overscrollBehaviorX = previousOverscroll;
    };
  }, []);

  return useCallback(async () => {
    releasedRef.current = true;
    unsubscribeRef.current();
    if (!isSentinelState(window.history.state)) return;
    const popped = waitForPopState();
    window.history.back();
    await popped;
  }, []);
}
