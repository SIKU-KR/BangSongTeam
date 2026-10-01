import { useEffect } from "react";
import {
  enterFullscreen,
  isFullscreenActive,
  subscribeFullscreenChange,
} from "./fullscreen";

/**
 * 송출 화면에 들어오면 전체화면을 요청하고, 한 번 전체화면이 됐다가 풀리면
 * (Esc, 브라우저 버튼) `onExit`을 부른다. 전체화면을 쓸 수 없는 브라우저에서는
 * 전체화면이 된 적이 없으므로 창 안 송출이 그대로 이어진다.
 */
export function useFullscreenSession(onExit: () => void): void {
  useEffect(() => {
    if (!isFullscreenActive()) {
      enterFullscreen().catch(() => {});
    }

    let hasBeenFullscreen = isFullscreenActive();

    return subscribeFullscreenChange(() => {
      if (isFullscreenActive()) {
        hasBeenFullscreen = true;
        return;
      }
      if (hasBeenFullscreen) {
        onExit();
      }
    });
  }, [onExit]);
}
