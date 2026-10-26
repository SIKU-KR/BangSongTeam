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
  const described: LoggedError = {
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
 * `Error`를 그대로 `JSON.stringify`하면 `{}`로 남는다. 감싼 오류는 `cause`에 실제 원인이
 * 있으므로 따라간다.
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
  writeLog("ERROR", {
    event,
    requestId: c.get("requestId"),
    route: routePath(c),
    error: describeError(error),
    ...context,
  });
}

export type LogSeverity = "INFO" | "WARNING" | "ERROR";

/**
 * 구조화 로그 한 줄을 남긴다. Cloud Run은 표준 출력의 한 줄 JSON을 Cloud Logging의
 * `jsonPayload`로 받고 `severity`를 로그 수준으로 쓴다.
 * https://cloud.google.com/run/docs/logging#writing_structured_logs
 */
export function writeLog(
  severity: LogSeverity,
  entry: Record<string, unknown>,
): void {
  const line = JSON.stringify({ severity, ...entry });
  if (severity === "ERROR") console.error(line);
  else console.log(line);
}
