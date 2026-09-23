import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 송출 경과 시간 타이머 (PRD 5 화면 목록 '발표자 보기 — 타이머').
 *
 * PRD에는 '타이머' 한 줄만 있고 세부 명세가 없다. 예배 송출에서 조작자가 실제로
 * 보는 값은 두 가지다 — 찬양을 시작한 지 얼마나 됐는지(경과 시간)와 지금 몇
 * 시인지(예배 순서를 맞추기 위한 현재 시각). 둘 다 제공한다.
 */

export interface UseElapsedTimerReturn {
  /** 경과 시간 (mm:ss, 1시간을 넘기면 h:mm:ss) */
  elapsed: string;
  /** 경과 초 */
  elapsedSeconds: number;
  /** 현재 시각 (HH:MM) */
  clock: string;
  isRunning: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
}

export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

export function useElapsedTimer(
  options: { autoStart?: boolean } = {},
): UseElapsedTimerReturn {
  const { autoStart = true } = options;

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(autoStart);
  const [clock, setClock] = useState(() => formatClock(new Date()));

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 현재 시각은 타이머가 멈춰 있어도 계속 흐른다.
    const tick = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isRunning]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);
  const reset = useCallback(() => setElapsedSeconds(0), []);

  return {
    elapsed: formatElapsed(elapsedSeconds),
    elapsedSeconds,
    clock,
    isRunning,
    start,
    pause,
    reset,
  };
}
