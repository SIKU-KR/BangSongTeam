import { useState, useRef, useCallback, useEffect } from "react";
import { PRESENTATION_SHORTCUTS } from "@repo/shared";

export interface UseNavigationBufferOptions {
  /**
   * 현재 재생/선택 중인 곡의 0-based 인덱스 (기본값: 0)
   */
  currentSongIndex?: number;
  /**
   * 전체 곡 수 (유효성 검사용)
   */
  songCount?: number;
  /**
   * 해당 곡의 슬라이드 개수를 반환하는 함수 (0-based songIndex 전달)
   */
  getSlideCount?: (songIndex: number) => number;
  /**
   * 유효한 슬라이드 번호 입력 후 Enter 입력 시 호출되는 점프 콜백
   */
  onJump: (songIndex: number, slideIndex: number) => void;
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
 * 프레젠테이션 숫자 키패드 점프 버퍼 훅
 * - N Enter: 현재 곡의 N번째 슬라이드 (slideIndex: N - 1)
 * - N. Enter: N번째 곡의 1번째 슬라이드 (songIndex: N - 1, slideIndex: 0)
 * - N.M Enter: N번째 곡의 M번째 슬라이드 (songIndex: N - 1, slideIndex: M - 1)
 * - Backspace: 버퍼 마지막 문자 삭제
 * - 3초 무입력 시 자동 클리어
 */
export function useNavigationBuffer({
  currentSongIndex = 0,
  songCount,
  getSlideCount,
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

        // 구문 분석
        let targetSongIndex: number;
        let targetSlideIndex: number;

        if (raw.includes(".")) {
          if (raw.endsWith(".")) {
            // N. 형태 (N번째 곡의 첫 번째 슬라이드)
            const songPart = raw.slice(0, -1);
            const songNum = parseInt(songPart, 10);
            if (isNaN(songNum) || songNum <= 0) {
              onInvalidJump?.(raw);
              return;
            }
            targetSongIndex = songNum - 1;
            targetSlideIndex = 0;
          } else {
            // N.M 형태 (N번째 곡의 M번째 슬라이드)
            const parts = raw.split(".");
            if (parts.length !== 2) {
              onInvalidJump?.(raw);
              return;
            }
            const songNum = parseInt(parts[0], 10);
            const slideNum = parseInt(parts[1], 10);
            if (isNaN(songNum) || isNaN(slideNum) || songNum <= 0 || slideNum <= 0) {
              onInvalidJump?.(raw);
              return;
            }
            targetSongIndex = songNum - 1;
            targetSlideIndex = slideNum - 1;
          }
        } else {
          // N 형태 (현재 곡의 N번째 슬라이드)
          const slideNum = parseInt(raw, 10);
          if (isNaN(slideNum) || slideNum <= 0) {
            onInvalidJump?.(raw);
            return;
          }
          targetSongIndex = currentSongIndex;
          targetSlideIndex = slideNum - 1;
        }

        // 인덱스 범위 유효성 검증
        if (songCount !== undefined && (targetSongIndex < 0 || targetSongIndex >= songCount)) {
          onInvalidJump?.(raw);
          return;
        }

        if (getSlideCount !== undefined) {
          const maxSlides = getSlideCount(targetSongIndex);
          if (targetSlideIndex < 0 || targetSlideIndex >= maxSlides) {
            onInvalidJump?.(raw);
            return;
          }
        }

        onJump(targetSongIndex, targetSlideIndex);
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

      // 4. 점 (.) - 첫 글자로 올 수 없으며 1개까지만 허용
      if (key === ".") {
        if (bufferRef.current.length > 0 && !bufferRef.current.includes(".")) {
          const next = bufferRef.current + ".";
          bufferRef.current = next;
          setBuffer(next);
          resetTimer();
        }
        return;
      }

      // 그 외 키는 무시
    },
    [
      clearTimer,
      currentSongIndex,
      getSlideCount,
      onInvalidJump,
      onJump,
      resetTimer,
      songCount,
    ],
  );

  return {
    buffer,
    handleKey,
    clearBuffer,
  };
}
