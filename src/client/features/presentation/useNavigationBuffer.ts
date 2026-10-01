import { useRef, useCallback, useEffect } from "react";
import { PRESENTATION_SHORTCUTS } from "#shared";

export interface UseNavigationBufferOptions {
  totalSlides?: number;
  onJump: (slideNumber: number) => void;
}

export interface UseNavigationBufferReturn {
  handleKey: (key: string) => void;
}

/**
 * `onJump`에 전달되는 번호는 세트 전체에서 1부터 이어지는 슬라이드 번호이며, 곡 경계와 무관하다.
 */
export function useNavigationBuffer({
  totalSlides,
  onJump,
}: UseNavigationBufferOptions): UseNavigationBufferReturn {
  const bufferRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      bufferRef.current = "";
      timerRef.current = null;
    }, PRESENTATION_SHORTCUTS.BUFFER_CLEAR_TIMEOUT_MS);
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const handleKey = useCallback(
    (key: string) => {
      if (key === "Backspace") {
        if (bufferRef.current.length > 0) {
          const next = bufferRef.current.slice(0, -1);
          bufferRef.current = next;
          if (next.length > 0) {
            resetTimer();
          } else {
            clearTimer();
          }
        }
        return;
      }

      if (key === "Enter") {
        const raw = bufferRef.current.trim();
        if (raw.length === 0) {
          return;
        }

        clearTimer();
        bufferRef.current = "";

        const slideNumber = Number(raw);
        if (
          !Number.isInteger(slideNumber) ||
          slideNumber <= 0 ||
          (totalSlides !== undefined && slideNumber > totalSlides)
        ) {
          return;
        }

        onJump(slideNumber);
        return;
      }

      if (/^[0-9]$/.test(key)) {
        const next = bufferRef.current + key;
        bufferRef.current = next;
        resetTimer();
        return;
      }
    },
    [clearTimer, onJump, resetTimer, totalSlides],
  );

  return { handleKey };
}
