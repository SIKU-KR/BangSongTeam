import { useEffect, useRef } from "react";
import { tinykeys } from "tinykeys";

export interface UsePresentationShortcutsOptions {
  onNext?: () => void;
  onPrev?: () => void;
  onToggleBlackout?: () => void;
  onToggleLyrics?: () => void;
  onExit?: () => void;
  handleKey?: (key: string) => void;
  navigationBuffer?: { handleKey: (key: string) => void };
  enabled?: boolean;
  target?: Window | HTMLElement;
}

/**
 * 무선 리모컨(클리커)은 키보드 이벤트로 동작하므로 tinykeys 키보드 바인딩만으로 대응한다.
 */
export function usePresentationShortcuts({
  onNext,
  onPrev,
  onToggleBlackout,
  onToggleLyrics,
  onExit,
  handleKey,
  navigationBuffer,
  enabled = true,
  target,
}: UsePresentationShortcutsOptions): void {
  const activeHandleKey = handleKey ?? navigationBuffer?.handleKey;

  const callbacksRef = useRef({
    onNext,
    onPrev,
    onToggleBlackout,
    onToggleLyrics,
    onExit,
    handleKey: activeHandleKey,
  });

  callbacksRef.current = {
    onNext,
    onPrev,
    onToggleBlackout,
    onToggleLyrics,
    onExit,
    handleKey: activeHandleKey,
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const eventTarget =
      target ?? (typeof window !== "undefined" ? window : null);
    if (!eventTarget) {
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
      ArrowLeft: (event) => {
        event.preventDefault();
        callbacksRef.current.onPrev?.();
      },
      PageUp: (event) => {
        event.preventDefault();
        callbacksRef.current.onPrev?.();
      },

      b: (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleBlackout?.();
      },
      "Shift+b": (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleBlackout?.();
      },
      B: (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleBlackout?.();
      },
      "Shift+B": (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleBlackout?.();
      },
      h: (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleLyrics?.();
      },
      "Shift+h": (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleLyrics?.();
      },
      H: (event) => {
        event.preventDefault();
        callbacksRef.current.onToggleLyrics?.();
      },
      "Shift+H": (event) => {
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

    const unsubscribe = tinykeys(eventTarget, keybindings);

    return () => {
      unsubscribe();
    };
  }, [enabled, target]);
}
