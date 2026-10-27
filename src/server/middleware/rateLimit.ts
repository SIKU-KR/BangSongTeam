import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";
import { clientIp, rateLimitKey } from "../lib/clientIp";
import {
  createFixedWindowLimiter,
  type FixedWindowLimiterOptions,
} from "../lib/rateLimit";

/**
 * 요청한 IP마다 `windowMs` 안에 `limit`건까지 받고, 넘으면 429로 끊는다. IPv6는 /64 대역
 * 하나를 한 IP로 센다(`rateLimitKey`).
 *
 * 로그인 없이 부를 수 있는 엔드포인트가 요청마다 키우는 비용(로그 줄, Firestore 읽기)을
 * 묶는다. IP는 `clientIp`가 정하므로 run.app에 직접 보낸 요청은 위조할 수 있고, 한도는
 * 인스턴스마다 따로 센다. 남용을 줄이는 최선 노력 방어다.
 *
 * 429에는 지금 창이 끝날 때까지 남은 초를 `Retry-After`로 단다. 그보다 일찍 다시 보내면 같은
 * 창이라 또 막히므로, 이 값을 따르는 클라이언트가 헛된 재시도를 하지 않게 한다.
 */
export function limitPerClientIp(
  options: FixedWindowLimiterOptions,
): MiddlewareHandler<AppEnv> {
  const take = createFixedWindowLimiter(options);
  return createMiddleware<AppEnv>(async (c, next) => {
    const decision = take(rateLimitKey(clientIp(c.req.raw.headers)));
    if (!decision.allowed) {
      c.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
      return c.json({ error: API_ERRORS.tooManyRequests }, 429);
    }
    await next();
  });
}
