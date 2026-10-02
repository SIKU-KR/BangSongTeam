import { useEffect, type RefObject } from "react";
import { resolveFullscreenStrategy } from "../../lib/browser/fullscreen";
import { isControlTarget } from "../../lib/browser/keyboardTarget";
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreenActive,
} from "./fullscreen";

interface KeyboardLockApi {
  lock?: (keyCodes?: string[]) => Promise<void>;
  unlock?: () => void;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

function keyboardLockApi(): KeyboardLockApi | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
}

/**
 * 송출 화면의 전체화면을 지킨다.
 *
 * 전체화면이 풀려도(HDMI 재연결, Win+P, 탭 전환, Safari·Firefox의 Esc) 송출은 끝내지 않는다.
 * 운영자의 다음 키 입력이나 클릭이 사용자 활성화를 주므로 그 이벤트 안에서 동기로 다시
 * 전체화면을 요청한다. 새로고침 뒤 첫 키 입력도 같은 길로 전체화면을 되찾는다.
 * 마우스는 pointerdown이, 터치·펜은 pointerup이 사용자 활성화를 주므로 각각 그때 요청한다.
 * Esc는 다시 요청하지 않고 송출 종료 단축키에 맡기며, 버튼 위의 입력은 버튼이 정한 동작에 맡긴다.
 * 수정 키나 수정 키 조합(⌘+Tab 같은 앱 전환)도 다시 요청하지 않는다.
 * `isExitingRef`가 true면 종료하는 중이므로 다시 요청하지 않는다.
 *
 * Chromium은 `navigator.keyboard.lock(["Escape"])`로 짧은 Esc를 페이지가 받게 해서
 * Esc 한 번에 송출이 끝나게 한다. 길게 누르면 브라우저가 전체화면만 푼다.
 *
 * 종료 버튼이나 Esc를 거치지 않고 다른 주소로 떠나면 전체화면을 풀어, 다음 화면이 전체화면에
 * 갇히지 않게 한다. 주소가 그대로인 언마운트(StrictMode 재실행, 로그인 상태에 따른 화면 교체)는
 * 곧 다시 마운트되므로 그대로 둔다.
 */
export function useFullscreenSession(isExitingRef: RefObject<boolean>): void {
  useEffect(() => {
    if (resolveFullscreenStrategy(document).kind === "unsupported") return;

    if (!isFullscreenActive()) {
      enterFullscreen().catch(() => {});
    }

    const keyboard = keyboardLockApi();
    keyboard?.lock?.(["Escape"]).catch(() => {});

    const reenter = (event: Event): void => {
      if (isExitingRef.current || isFullscreenActive()) return;
      if (isControlTarget(event.target)) return;
      enterFullscreen().catch(() => {});
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || MODIFIER_KEYS.has(event.key)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      reenter(event);
    };

    const handlePointer = (event: PointerEvent): void => {
      const isTouchOrPen =
        event.pointerType === "touch" || event.pointerType === "pen";
      if (isTouchOrPen === (event.type === "pointerup")) reenter(event);
    };

    const mountedPath = window.location.pathname;
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointer, true);
    window.addEventListener("pointerup", handlePointer, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointer, true);
      window.removeEventListener("pointerup", handlePointer, true);
      keyboard?.unlock?.();
      if (window.location.pathname !== mountedPath) {
        exitFullscreen().catch(() => {});
      }
    };
  }, [isExitingRef]);
}
