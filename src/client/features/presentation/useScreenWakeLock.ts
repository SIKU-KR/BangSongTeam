import { useEffect } from "react";

/**
 * 송출 중 화면이 꺼지지 않게 Screen Wake Lock을 잡는다.
 *
 * 이미지·단색 배경과 블랙아웃에는 재생 중인 영상이 없고, Safari는 소리 없는 영상으로
 * 화면을 깨워 두지 않는다. 그대로 두면 설교 중에 디스플레이가 잠들어 프로젝터에
 * 신호 없음이 뜬다. 탭이 가려지면 브라우저가 잠금을 풀므로 다시 보일 때 새로 잡는다.
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
      } catch {
        return;
      } finally {
        isRequesting = false;
      }
    };

    const handleVisibilityChange = (): void => {
      void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      isDisposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sentinel?.release().catch(() => {});
    };
  }, []);
}
