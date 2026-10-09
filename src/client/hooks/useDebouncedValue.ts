import { useEffect, useState } from "react";

/** 입력이 `delayMs` 동안 멈춘 뒤의 값. 타이핑마다 서버 검색을 보내지 않으려고 쓴다 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
