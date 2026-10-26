import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

const BASE_SECONDS = 2;
const MAX_SECONDS = 60;
const MAX_DOUBLINGS = 6;
const QUIET_RESET_MS = 60_000;

export interface RetryAfterPolicyOptions {
  now?: () => number;
  random?: () => number;
}

/**
 * 일시 장애 503마다 `Retry-After`(초)를 하나 고른다.
 *
 * 이 인스턴스가 연달아 본 일시 장애 수만큼 상한을 4·8·16·32초로 두 배씩 늘리고(최대 60초),
 * 상한의 절반과 상한 사이에서 무작위로 고른다. 60초 동안 일시 장애가 없으면 처음부터 다시
 * 센다. 상태가 인스턴스 메모리에만 있어 최선 노력이다.
 */
export function createRetryAfterPolicy({
  now = Date.now,
  random = Math.random,
}: RetryAfterPolicyOptions = {}): () => number {
  let streak = 0;
  let lastAt = -Infinity;

  return () => {
    const at = now();
    streak = at - lastAt >= QUIET_RESET_MS ? 1 : streak + 1;
    lastAt = at;
    const ceiling = Math.min(
      MAX_SECONDS,
      BASE_SECONDS * 2 ** Math.min(streak, MAX_DOUBLINGS),
    );
    const floor = Math.max(BASE_SECONDS, ceiling / 2);
    return Math.round(floor + random() * (ceiling - floor));
  };
}

/**
 * 503 응답에 `Retry-After`를 단다. 라우트와 `onError`는 503만 돌려주고 이 헤더는 여기서만
 * 정한다.
 *
 * 값이 늘 2초면 장애 중 클라이언트가 같은 박자로 몰려 다시 보내고, 이 값을 그대로 기다리는
 * 이전 클라이언트는 재시도 10번을 20초 안에 다 써 동기화 실패로 멈춘다. 그래서
 * {@link createRetryAfterPolicy}로 늘리고 흩뜨린다.
 */
export function retryAfterOnUnavailable(
  policy: () => number = createRetryAfterPolicy(),
): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    await next();
    if (c.res.status === 503 && !c.res.headers.has("retry-after")) {
      c.header("Retry-After", String(policy()));
    }
  });
}
