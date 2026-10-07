import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { bytesToHex, randomHex } from "#shared";
import type { AppEnv } from "../types";
import { describeError } from "../lib/requestLog";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO_TRACE_ID = "0".repeat(32);

/**
 * 요청의 상관 ID를 정한다. 브라우저가 보낸 W3C `traceparent`의 trace-id를 쓰고,
 * 없거나 형식이 틀리면 새로 만든다.
 *
 * 브라우저가 ID를 만들어야 응답을 받지 못한 요청(타임아웃·끊김)도 사용자 화면과 Worker
 * 로그를 같은 값으로 이을 수 있다.
 */
export function resolveRequestId(headers: Headers): string {
  const traceId = TRACEPARENT.exec(headers.get("traceparent") ?? "")?.[1];
  if (traceId && traceId !== ZERO_TRACE_ID) return traceId;
  return randomHex(16);
}

async function hashUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId),
  );
  return bytesToHex(new Uint8Array(digest).slice(0, 8));
}

/**
 * 요청마다 구조화 로그 한 줄을 남기고 응답에 상관 ID(`x-request-id`)를 붙인다.
 * 모든 라우트보다 먼저 건다.
 *
 * 경로는 원문이 아니라 라우트 패턴(`/api/presentations/:id`)으로 남긴다. id·공유 토큰이
 * 로그에 쌓이지 않고, 같은 엔드포인트끼리 묶어 5xx 비율을 볼 수 있다.
 *
 * 사용자는 SHA-256 앞 16자리로만 남긴다. 소금을 치지 않아, 운영자가 문의한 사용자의 id를
 * 같은 방식으로 해시해 그 사용자의 요청만 골라 볼 수 있다.
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

    c.header("x-request-id", requestId);
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
    if (entry.status >= 500) {
      console.error({
        ...entry,
        ...(c.error ? { error: describeError(c.error) } : {}),
      });
    } else {
      console.log(entry);
    }
  });
}
