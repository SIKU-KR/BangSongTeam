import type { Context } from "hono";
import { isAPIError } from "better-auth/api";
import { createMiddleware } from "hono/factory";
import { getAuth } from "../lib/auth";
import type { AppEnv, Bindings } from "../types";
import { API_ERRORS } from "#shared";

/**
 * 세션 조회 결과.
 *
 * `setCookies`는 Better Auth가 조회 중에 갱신한 쿠키(세션 쿠키 캐시 등)다. 미들웨어가
 * 이를 응답에 실어 보내야 브라우저의 쿠키 캐시가 이어지고, 다음 요청도 D1을 거치지 않는다.
 */
export interface SessionResult {
  userId: string;
  setCookies?: string[];
}

/** 요청에서 세션 사용자를 읽어 오는 함수 (테스트에서 주입 가능) */
export type SessionReader = (input: {
  headers: Headers;
  env: Bindings;
}) => Promise<SessionResult | null>;

/**
 * Better Auth로 세션을 읽는 기본 구현.
 *
 * 쿠키 캐시(`session.cookieCache`)가 살아 있으면 D1을 읽지 않는다. 캐시가 만료돼
 * D1을 읽은 요청은 새 캐시 쿠키를 `setCookies`로 돌려준다.
 *
 * 쿠키가 없거나 만료·손상되면 Better Auth가 `null`을 준다. 갱신 중 세션이 지워진
 * `UNAUTHORIZED`만 세션 없음으로 바꾸고, 그 밖의 예외(D1 장애 등)는 그대로 던져
 * 5xx로 내린다. 401로 바꾸면 클라이언트가 서버 장애를 로그아웃으로 받는다.
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

function forwardCookies(c: Context<AppEnv>, setCookies?: string[]): void {
  for (const cookie of setCookies ?? []) {
    c.header("set-cookie", cookie, { append: true });
  }
}

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
    forwardCookies(c, session.setCookies);
  });
}

/**
 * 세션이 있으면 `userId`를 채우고, 없으면 그대로 통과시키는 미들웨어.
 *
 * 로그인 없이도 열리지만 로그인하면 내 데이터가 더해지는 목록(배경 라이브러리)용이다.
 */
export function createOptionalSession(
  readSession: SessionReader = readSessionFromBetterAuth,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await readSession({
      headers: c.req.raw.headers,
      env: c.env,
    });
    c.set("userId", session?.userId);
    await next();
    forwardCookies(c, session?.setCookies);
  });
}
