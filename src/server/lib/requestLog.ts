import { DrizzleQueryError } from "drizzle-orm";
import type { Context } from "hono";
import { routePath } from "hono/route";
import type { AppEnv } from "../types";

const MAX_CAUSE_DEPTH = 3;

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
