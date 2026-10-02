import { useEffect, useRef } from "react";
import { tinykeys } from "tinykeys";

interface UsePresentationShortcutsOptions {
  onNext?: () => void;
  onPrev?: () => void;
  onToggleBlackout?: () => void;
  onToggleLyrics?: () => void;
  onExit?: () => void;
  navigationBuffer?: { handleKey: (key: string) => void };
}

const HISTORY_KEY_CODES = new Set(["ArrowLeft", "ArrowRight"]);
const BRACKET_CODES = new Set(["BracketLeft", "BracketRight"]);
const MOUSE_BACK_BUTTON = 3;
const MOUSE_FORWARD_BUTTON = 4;

function isLeavingKey(event: KeyboardEvent): boolean {
  return (
    event.key === "F5" ||
    ((event.ctrlKey || event.metaKey) && event.code === "KeyR") ||
    (event.altKey && HISTORY_KEY_CODES.has(event.code)) ||
    (event.metaKey && BRACKET_CODES.has(event.code)) ||
    event.key === "BrowserBack" ||
    event.key === "BrowserForward"
  );
}

function blockLeavingKeys(event: KeyboardEvent): void {
  if (isLeavingKey(event)) event.preventDefault();
}

function blockHistoryButtons(event: MouseEvent): void {
  if (
    event.button === MOUSE_BACK_BUTTON ||
    event.button === MOUSE_FORWARD_BUTTON
  ) {
    event.preventDefault();
  }
}

/**
 * 송출 화면 단축키. 무선 리모컨(클리커)도 키보드 이벤트로 동작한다.
 *
 * 글자 단축키는 물리 키(`code`)로 묶어 한글 입력 상태에서도 동작한다.
 *
 * 새로고침(F5, Ctrl/⌘+R)과 뒤로·앞으로 가기(Alt+←→, ⌘+[ ], 브라우저 키, 마우스 옆 버튼)는
 * 기본 동작을 막는다. 예배 중에 송출 화면이 다시 뜨거나 떠나면 안 되기 때문이다.
 * tinykeys는 키를 누르고 있을 때(`repeat`)와 조합 중인 입력을 건너뛰므로 이 차단은
 * 별도의 keydown 리스너가 맡는다.
 */
export function usePresentationShortcuts({
  onNext,
  onPrev,
  onToggleBlackout,
  onToggleLyrics,
  onExit,
  navigationBuffer,
}: UsePresentationShortcutsOptions): void {
  const callbacksRef = useRef({
    onNext,
    onPrev,
    onToggleBlackout,
    onToggleLyrics,
    onExit,
    handleKey: navigationBuffer?.handleKey,
  });

  callbacksRef.current = {
    onNext,
    onPrev,
    onToggleBlackout,
    onToggleLyrics,
    onExit,
    handleKey: navigationBuffer?.handleKey,
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const keybindings: Record<string, (event: KeyboardEvent) => void> = {
      ArrowRight: (event) => {
        event.preventDefault();
        callbacksRef.current.onNext?.();
      },
      Space: (event) => {
        event.preventDefault();
        callbacksRef.current.onNext?.();
      },
      PageDown: (event) => {
        event.preventDefault();
        callbacksRef.current.onNext?.();
      },
      ArrowDown: (event) => {
        event.preventDefault();
        callbacksRef.current.onNext?.();
      },
      ArrowLeft: (event) => {
        event.preventDefault();
        callbacksRef.current.onPrev?.();
      },
      ArrowUp: (event) => {
        event.preventDefault();
        callbacksRef.current.onPrev?.();
      },
      PageUp: (event) => {
        event.preventDefault();
        callbacksRef.current.onPrev?.();
      },

      "[Shift]+KeyB": (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleBlackout?.();
      },
      Period: (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleBlackout?.();
      },
      "[Shift]+KeyH": (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleLyrics?.();
      },

      Escape: (event) => {
        event.preventDefault();
        callbacksRef.current.onExit?.();
      },

      Enter: (event) => {
        event.preventDefault();
        callbacksRef.current.handleKey?.("Enter");
      },
      Backspace: (event) => {
        event.preventDefault();
        callbacksRef.current.handleKey?.("Backspace");
      },
    };

    for (let i = 0; i <= 9; i++) {
      const digit = String(i);
      keybindings[digit] = (event) => {
        event.preventDefault();
        callbacksRef.current.handleKey?.(digit);
      };
    }

    const unsubscribe = tinykeys(window, keybindings);
    window.addEventListener("keydown", blockLeavingKeys);
    window.addEventListener("mouseup", blockHistoryButtons);
    window.addEventListener("auxclick", blockHistoryButtons);

    return () => {
      unsubscribe();
      window.removeEventListener("keydown", blockLeavingKeys);
      window.removeEventListener("mouseup", blockHistoryButtons);
      window.removeEventListener("auxclick", blockHistoryButtons);
    };
  }, []);
}
