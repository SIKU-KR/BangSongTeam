import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import type { AppEnv } from "../types";
import { describeError, hashUserId, resolveRequestId } from "../lib/requestLog";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * 요청마다 구조화 로그 한 줄을 남기고 응답에 상관 ID(`x-request-id`)를 붙인다.
 * 모든 라우트보다 먼저 건다.
 *
 * 경로는 원문이 아니라 라우트 패턴(`/api/presentations/:id`)으로 남긴다. id·공유 토큰이
 * 로그에 쌓이지 않고, 같은 엔드포인트끼리 묶어 5xx 비율을 볼 수 있다. 사용자는 해시로만
 * 남긴다. 5xx는 `console.error`로 남기고, 처리되지 않은 예외면 `onError`가 받은 오류
 * (`c.error`)를 원인 사슬과 함께 싣는다.
 *
 * 헤더는 `next()` 뒤에 붙인다. 미디어·Better Auth처럼 `Response`를 직접 돌려주는
 * 라우트는 미리 준비한 헤더를 쓰지 않으므로, 완성된 응답에 붙여야 빠지지 않는다.
 */
export function requestLog(): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = resolveRequestId(c.req.raw.headers);
    c.set("requestId", requestId);
    const start = Date.now();

    await next();

    c.header(REQUEST_ID_HEADER, requestId);
    const userId = c.get("userId");
    const entry = {
      event: "request",
      requestId,
      cfRay: c.req.header("cf-ray") ?? null,
      method: c.req.method,
      route: routePath(c),
      status: c.res.status,
      durationMs: Date.now() - start,
      ...(userId ? { userHash: await hashUserId(userId) } : {}),
    };
    if (c.res.status >= 500) {
      console.error({
        ...entry,
        ...(c.error ? { error: describeError(c.error) } : {}),
      });
    } else {
      console.log(entry);
    }
  });
}
