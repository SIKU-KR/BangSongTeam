import { useEffect } from "react";

/**
 * 송출 중 화면이 꺼지지 않게 Screen Wake Lock을 잡는다.
 *
 * 이미지·단색 배경과 블랙아웃에는 재생 중인 영상이 없고, Safari는 소리 없는 영상으로
 * 화면을 깨워 두지 않는다. 그대로 두면 설교 중에 디스플레이가 잠들어 프로젝터에
 * 신호 없음이 뜬다. 탭이 가려지거나 절전 정책으로 브라우저가 잠금을 풀면 다시 보일 때,
 * 또는 풀렸다는 알림을 받을 때 새로 잡는다. Safari는 사용자 활성화 없이 요청하면 거부하므로
 * (WebKit bug 254545) 운영자의 키 입력·클릭마다 잠금이 없으면 다시 요청한다.
 * 지원하지 않거나 거부되면 조용히 넘어간다.
 */
export function useScreenWakeLock(): void {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let isRequesting = false;
    let isDisposed = false;

    const acquire = async (): Promise<void> => {
      if (isDisposed || isRequesting) return;
      if (document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      isRequesting = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (isDisposed) {
          await next.release();
          return;
        }
        sentinel = next;
        next.addEventListener("release", reacquire);
      } catch {
        return;
      } finally {
        isRequesting = false;
      }
    };

    const reacquire = (): void => {
      void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", reacquire);
    window.addEventListener("keydown", reacquire, true);
    window.addEventListener("pointerdown", reacquire, true);
    return () => {
      isDisposed = true;
      document.removeEventListener("visibilitychange", reacquire);
      window.removeEventListener("keydown", reacquire, true);
      window.removeEventListener("pointerdown", reacquire, true);
      sentinel?.release().catch(() => {});
    };
  }, []);
}
