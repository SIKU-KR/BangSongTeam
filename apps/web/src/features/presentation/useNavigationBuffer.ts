import { useState, useRef, useCallback, useEffect } from "react";
import { PRESENTATION_SHORTCUTS } from "@repo/shared";

export interface UseNavigationBufferOptions {
  /**
   * 세트 전체 슬라이드 수 (유효성 검사용). 없으면 상한을 검사하지 않는다.
   */
  totalSlides?: number;
  /**
   * 유효한 번호 입력 후 Enter 입력 시 호출되는 점프 콜백.
   * `slideNumber`는 세트 전체에서 1부터 이어지는 슬라이드 번호다.
   */
  onJump: (slideNumber: number) => void;
  /**
   * 유효하지 않은 입력으로 점프 실패 시 호출되는 콜백 (예: 발표자 뷰 알림 표시)
   */
  onInvalidJump?: (buffer: string) => void;
  /**
   * 무입력 시 버퍼 자동 초기화 제한 시간(ms, 기본값: 3000ms)
   */
  timeoutMs?: number;
}

export interface UseNavigationBufferReturn {
  buffer: string;
  handleKey: (key: string) => void;
  clearBuffer: () => void;
}

/**
 * 프레젠테이션 숫자 키패드 점프 버퍼 훅 (PPT식 번호)
 * - N Enter: 세트 전체에서 N번째 슬라이드. 곡 경계와 상관없이 1부터 이어진다
 * - Backspace: 버퍼 마지막 문자 삭제
 * - 3초 무입력 시 자동 클리어
 */
export function useNavigationBuffer({
  totalSlides,
  onJump,
  onInvalidJump,
  timeoutMs = PRESENTATION_SHORTCUTS.BUFFER_CLEAR_TIMEOUT_MS,
}: UseNavigationBufferOptions): UseNavigationBufferReturn {
  const [buffer, setBuffer] = useState<string>("");
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
      setBuffer("");
      timerRef.current = null;
    }, timeoutMs);
  }, [clearTimer, timeoutMs]);

  // 언마운트 시 타이머 클린업
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const clearBuffer = useCallback(() => {
    clearTimer();
    bufferRef.current = "";
    setBuffer("");
  }, [clearTimer]);

  const handleKey = useCallback(
    (key: string) => {
      // 1. Backspace: 버퍼 마지막 글자 삭제
      if (key === "Backspace") {
        if (bufferRef.current.length > 0) {
          const next = bufferRef.current.slice(0, -1);
          bufferRef.current = next;
          setBuffer(next);
          if (next.length > 0) {
            resetTimer();
          } else {
            clearTimer();
          }
        }
        return;
      }

      // 2. Enter: 버퍼 평가 후 점프 또는 클리어
      if (key === "Enter") {
        const raw = bufferRef.current.trim();
        if (raw.length === 0) {
          return;
        }

        clearTimer();
        bufferRef.current = "";
        setBuffer("");

        const slideNumber = Number(raw);
        if (
          !Number.isInteger(slideNumber) ||
          slideNumber <= 0 ||
          (totalSlides !== undefined && slideNumber > totalSlides)
        ) {
          onInvalidJump?.(raw);
          return;
        }

        onJump(slideNumber);
        return;
      }

      // 3. 숫자 키 (0 ~ 9)
      if (/^[0-9]$/.test(key)) {
        const next = bufferRef.current + key;
        bufferRef.current = next;
        setBuffer(next);
        resetTimer();
        return;
      }

      // 그 외 키는 무시
    },
    [clearTimer, onInvalidJump, onJump, resetTimer, totalSlides],
  );

  return {
    buffer,
    handleKey,
    clearBuffer,
  };
}
