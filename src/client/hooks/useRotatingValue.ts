import { useEffect, useState } from "react";

/**
 * `intervalMs`마다 `items`를 차례로 돌려 가며 고른 값. 검색창 예시 문장처럼 비어 있을
 * 때만 보이는 내용에 쓰므로, `enabled`가 false인 동안에는 타이머를 멈춘다.
 */
export function useRotatingValue<T>(
  items: readonly [T, ...T[]],
  intervalMs: number,
  enabled: boolean,
): T {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!enabled || items.length < 2) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % items.length),
      intervalMs,
    );
    return () => clearInterval(timer);
  }, [enabled, items.length, intervalMs]);
  return items[index % items.length] ?? items[0];
}
