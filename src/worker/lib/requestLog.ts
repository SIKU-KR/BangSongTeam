import { DrizzleQueryError } from "drizzle-orm";
import type { Context } from "hono";
import { routePath } from "hono/route";
import { bytesToHex, randomHex } from "#shared";
import type { AppEnv } from "../types";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const ZERO_TRACE_ID = "0".repeat(32);
const MAX_CAUSE_DEPTH = 3;

/**
 * 요청의 상관 ID를 정한다. 브라우저가 보낸 W3C `traceparent`의 trace-id를 먼저 쓴다.
 *
 * 브라우저가 ID를 만들어야 응답을 받지 못한 요청(타임아웃·끊김)도 사용자 화면과 Worker
 * 로그를 같은 값으로 이을 수 있다. `traceparent`가 없거나 형식이 틀리면(예전 클라이언트,
 * 직접 호출) `cf-ray`, 그것도 없으면(로컬·테스트) 무작위 값을 쓴다.
 */
export function resolveRequestId(headers: Headers): string {
  const match = TRACEPARENT.exec(headers.get("traceparent") ?? "");
  if (match && match[1] !== ZERO_TRACE_ID) return match[1];
  return headers.get("cf-ray") ?? randomHex(16);
}

/**
 * 로그에 남길 사용자 식별값. SHA-256의 앞 16자리다.
 *
 * 원래 id를 로그에 두지 않으면서도, 운영자가 문의한 사용자의 id를 같은 방식으로
 * 해시해 그 사용자의 요청만 골라 볼 수 있게 소금을 치지 않는다.
 */
export async function hashUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId),
  );
  return bytesToHex(new Uint8Array(digest).slice(0, 8));
}

interface LoggedError {
  name: string;
  message: string;
  stack?: string;
  cause?: LoggedError;
}

function describeAt(err: unknown, depth: number): LoggedError {
  if (!(err instanceof Error)) {
    return { name: typeof err, message: String(err) };
  }
  const described: LoggedError =
    err instanceof DrizzleQueryError
      ? { name: "DrizzleQueryError", message: `Failed query: ${err.query}` }
      : {
          name: err.name,
          message: err.message,
          ...(err.stack ? { stack: err.stack } : {}),
        };
  if (err.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    described.cause = describeAt(err.cause, depth + 1);
  }
  return described;
}

/**
 * 오류를 JSON 로그에 실을 수 있는 값으로 바꾼다. `cause`를 3단계까지 따라간다.
 *
 * `Error`를 그대로 넘기면 Workers Logs에 `{}`로 남는다. Drizzle은 D1 오류
 * (`D1_ERROR: ...`)를 `cause`에 감싸 던지므로, 따라가지 않으면 실제 원인이 빠진다.
 *
 * Drizzle의 `DrizzleQueryError`는 메시지와 스택 첫 줄에 바인딩 값(`params`)을 싣는다.
 * 덱 upsert면 그 값이 가사·슬라이드 JSON이므로, 이 오류는 SQL 문(값은 `?` 자리표시자)만
 * 남기고 스택은 버린다. 원인은 `cause`의 D1 오류가 알려 준다.
 */
export function describeError(err: unknown): LoggedError {
  return describeAt(err, 0);
}

/**
 * 라우트가 직접 잡아 5xx로 돌려주는 오류를 남긴다. 상관 ID와 라우트 패턴을 함께 실어
 * 요청 로그 줄과 이어 볼 수 있게 한다.
 *
 * 요청 본문은 읽지 않는다. 가사가 로그에 남으면 안 되므로, 호출자는 개수·id 같은
 * 요약만 `context`로 넘긴다.
 */
export function logServerError(
  c: Context<AppEnv>,
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  console.error({
    event,
    requestId: c.get("requestId"),
    route: routePath(c),
    error: describeError(error),
    ...context,
  });
}
