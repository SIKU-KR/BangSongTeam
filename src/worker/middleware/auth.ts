import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createAuth, isAdminUser } from "../lib/auth";
import type { AppEnv, Bindings, Variables } from "../types";

/**
 * 보호 라우트용 환경 타입.
 *
 * `AppEnv`의 `userId`는 선택값이라 핸들러마다 non-null 단언이 필요하다.
 * `requireAuth`를 통과한 뒤에는 항상 존재하므로 여기서 좁혀 둔다.
 */
export interface AuthedEnv {
  Bindings: Bindings;
  Variables: Variables & { userId: string };
}

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
 */
export const readSessionFromBetterAuth: SessionReader = async ({
  headers,
  env,
}) => {
  const auth = createAuth(env);
  const { headers: responseHeaders, response: session } =
    await auth.api.getSession({ headers, returnHeaders: true });
  const userId = session?.user?.id;
  return userId ? { userId, setCookies: responseHeaders.getSetCookie() } : null;
};

function forwardCookies(c: Context<AppEnv>, setCookies?: string[]): void {
  for (const cookie of setCookies ?? []) {
    c.header("set-cookie", cookie, { append: true });
  }
}

/**
 * 세션이 없으면 401로 끊는 미들웨어.
 *
 * 세션 조회 중 예외가 나도 401로 내린다. 만료·손상된 쿠키는 '서버 오류'가
 * 아니라 '로그인 안 됨'이다. 500으로 새면 클라이언트가 재로그인 대신
 * 재시도 루프를 돈다.
 */
export function createRequireAuth(
  readSession: SessionReader = readSessionFromBetterAuth,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let session: SessionResult | null = null;
    try {
      session = await readSession({ headers: c.req.raw.headers, env: c.env });
    } catch {
      session = null;
    }

    if (!session) {
      return c.json({ error: "로그인이 필요합니다" }, 401);
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
 * 세션 조회 실패는 비로그인으로 취급한다.
 */
export function createOptionalSession(
  readSession: SessionReader = readSessionFromBetterAuth,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let session: SessionResult | null = null;
    try {
      session = await readSession({ headers: c.req.raw.headers, env: c.env });
    } catch {
      session = null;
    }
    c.set("userId", session?.userId);
    await next();
    forwardCookies(c, session?.setCookies);
  });
}

/**
 * 관리자(`ADMIN_USER_IDS`)가 아니면 403으로 끊는 미들웨어.
 * `requireAuth` 뒤에 붙인다. 세션이 없는 요청은 앞에서 이미 401로 끝난다.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isAdminUser(c.env, c.get("userId"))) {
    return c.json({ error: "관리자만 할 수 있습니다" }, 403);
  }
  await next();
});

/** 기본 세션 검증 미들웨어 */
export const requireAuth = createRequireAuth();
