import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";
import { clientIp } from "../lib/clientIp";
import { createFixedWindowLimiter } from "../lib/rateLimit";

/**
 * 요청한 IP마다 `windowMs` 안에 `limit`건까지 받고, 넘으면 429로 끊는다.
 *
 * 로그인 없이 부를 수 있는 엔드포인트가 요청마다 키우는 비용(로그 줄, Firestore 읽기)을
 * 묶는다. IP는 `clientIp`가 정하므로 run.app에 직접 보낸 요청은 위조할 수 있고, 한도는
 * 인스턴스마다 따로 센다. 남용을 줄이는 최선 노력 방어다.
 */
export function limitPerClientIp(options: {
  limit: number;
  windowMs: number;
}): MiddlewareHandler<AppEnv> {
  const allow = createFixedWindowLimiter(options);
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!allow(clientIp(c.req.raw.headers))) {
      return c.json({ error: API_ERRORS.tooManyRequests }, 429);
    }
    await next();
  });
}
