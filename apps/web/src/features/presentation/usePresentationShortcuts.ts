import { useEffect, useRef } from "react";
import { tinykeys } from "tinykeys";

export interface UsePresentationShortcutsOptions {
  /**
   * 다음 슬라이드로 이동 (ArrowRight, Space, PageDown)
   */
  onNext?: () => void;
  /**
   * 이전 슬라이드로 이동 (ArrowLeft, PageUp)
   */
  onPrev?: () => void;
  /**
   * 블랙아웃 토글 (b, B)
   */
  onToggleBlackout?: () => void;
  /**
   * 가사 숨김 토글 (h, H)
   */
  onToggleLyrics?: () => void;
  /**
   * 프레젠테이션 송출 종료 (Escape)
   */
  onExit?: () => void;
  /**
   * 숫자 키패드 및 버퍼 조작 키(0-9, Enter, Backspace) 처리 핸들러
   */
  handleKey?: (key: string) => void;
  /**
   * useNavigationBuffer 훅의 반환 객체를 직접 넘길 수 있는 편의 옵션
   */
  navigationBuffer?: { handleKey: (key: string) => void };
  /**
   * 단축키 활성화 여부 (기본값: true)
   */
  enabled?: boolean;
  /**
   * 이벤트를 바인딩할 대상 요소 (기본값: window)
   */
  target?: Window | HTMLElement;
}

/**
 * 프레젠테이션 송출 모드 키보드 및 리모컨 단축키 이벤트 훅
 * - tinykeys 라이브러리를 사용하여 키보드/무선 리모컨(클리커) 단축키 바인딩
 * - ArrowRight / Space / PageDown -> 다음 슬라이드
 * - ArrowLeft / PageUp -> 이전 슬라이드
 * - 'b', 'B' -> 블랙아웃 토글
 * - 'h', 'H' -> 가사 숨김 토글
 * - 0~9, Enter, Backspace -> 네비게이션 버퍼의 handleKey로 위임
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
      // 1. 슬라이드 네비게이션
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

      // 2. 화면 모드 제어 (대소문자 지원)
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

      // 3. 송출 종료 (Esc)
      Escape: (event) => {
        event.preventDefault();
        callbacksRef.current.onExit?.();
      },

      // 3. 네비게이션 버퍼 제어 키
      Enter: (event) => {
        event.preventDefault();
        callbacksRef.current.handleKey?.("Enter");
      },
      Backspace: (event) => {
        event.preventDefault();
        callbacksRef.current.handleKey?.("Backspace");
      },
    };

    // 0 ~ 9 숫자 키 바인딩
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
