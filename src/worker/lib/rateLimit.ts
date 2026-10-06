const PRUNE_THRESHOLD = 1000;

interface LimitWindow {
  startedAt: number;
  count: number;
}

interface FixedWindowLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

/**
 * 고정 창(fixed window) 요청 빈도 제한. 키마다 `windowMs` 안에 `limit`건까지 허용한다.
 *
 * isolate 메모리에만 두므로 최선 노력이다. isolate가 여럿이거나 다시 뜨면 한도가 그만큼
 * 느슨해진다. 지키려는 것은 로그 양뿐이라(보고는 저장하지 않는다) 이 정도로 충분하고,
 * Rate Limiting 바인딩처럼 wrangler 설정과 새 리소스가 필요한 방법을 피한다.
 * 키가 쌓여 메모리가 늘지 않게, 1000개를 넘으면 지난 창을 비운다.
 */
export function createFixedWindowLimiter({
  limit,
  windowMs,
  now = Date.now,
}: FixedWindowLimiterOptions): (key: string) => boolean {
  const windows = new Map<string, LimitWindow>();

  const prune = (at: number): void => {
    for (const [key, entry] of windows) {
      if (at - entry.startedAt >= windowMs) windows.delete(key);
    }
  };

  return (key) => {
    const at = now();
    const current = windows.get(key);
    if (!current || at - current.startedAt >= windowMs) {
      if (!current && windows.size >= PRUNE_THRESHOLD) prune(at);
      windows.set(key, { startedAt: at, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}
