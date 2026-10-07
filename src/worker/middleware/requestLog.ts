import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { bytesToHex, randomHex } from "#shared";
import type { AppEnv } from "../types";
import { describeError } from "../lib/requestLog";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO_TRACE_ID = "0".repeat(32);

/**
 * Request ID를 정한다.
 * 브라우저가 보낸 W3C `traceparent`의 trace-id를 쓰거나 새로 만든다.
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
 * 사용자는 SHA-256 앞 16자리로만 남긴다.
 * 운영자가 문의한 사용자의 id를 같은 방식으로 해시해 그 사용자의 요청만 골라 볼 수 있다.
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
