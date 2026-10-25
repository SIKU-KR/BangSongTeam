import { isAPIError } from "better-auth/api";
import { createMiddleware } from "hono/factory";
import { getAuth } from "../lib/auth";
import type { AppEnv, Bindings } from "../types";
import { API_ERRORS } from "#shared";

export interface SessionResult {
  userId: string;
  /**
   * Better Auth가 조회 중에 갱신한 쿠키(세션 쿠키 캐시 등).
   *
   * 응답에 실어 보내야 쿠키 캐시가 이어져 다음 요청이 D1을 읽지 않는다.
   */
  setCookies?: string[];
}

/**
 * 요청에서 세션 사용자를 읽는 함수. 테스트가 세션을 흉내 내려고 주입한다.
 *
 * `null`은 세션 없음(401)이다. 조회 자체가 실패하면 `null` 대신 예외를 던져야
 * 5xx로 내려가고, 클라이언트가 서버 장애를 로그아웃으로 받지 않는다.
 */
export type SessionReader = (input: {
  headers: Headers;
  env: Bindings;
}) => Promise<SessionResult | null>;

/**
 * Better Auth로 세션을 읽는 기본 구현.
 *
 * 갱신 중 세션이 지워지면 Better Auth가 `UNAUTHORIZED`를 던지므로 이것만 세션
 * 없음으로 바꾸고, 그 밖의 예외(D1 장애 등)는 그대로 던진다.
 */
export const readSessionFromBetterAuth: SessionReader = async ({
  headers,
  env,
}) => {
  const auth = getAuth(env);
  let result;
  try {
    result = await auth.api.getSession({ headers, returnHeaders: true });
  } catch (error) {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") return null;
    throw error;
  }
  const { headers: responseHeaders, response } = result;
  if (!response) return null;

  return {
    userId: response.user.id,
    setCookies: responseHeaders.getSetCookie(),
  };
};

/** 세션이 없으면 401로 끊는 미들웨어. */
export function createRequireAuth(
  readSession: SessionReader = readSessionFromBetterAuth,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await readSession({
      headers: c.req.raw.headers,
      env: c.env,
    });

    if (!session) {
      return c.json({ error: API_ERRORS.loginRequired }, 401);
    }

    c.set("userId", session.userId);
    await next();
    for (const cookie of session.setCookies ?? []) {
      c.header("set-cookie", cookie, { append: true });
    }
  });
}
