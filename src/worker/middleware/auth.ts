import { createMiddleware } from "hono/factory";
import { createAuth } from "../lib/auth";
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

/** 요청에서 세션 사용자를 읽어 오는 함수 (테스트에서 주입 가능) */
export type SessionReader = (input: {
  headers: Headers;
  env: Bindings;
}) => Promise<{ userId: string } | null>;

/** Better Auth로 세션을 읽는 기본 구현 */
export const readSessionFromBetterAuth: SessionReader = async ({
  headers,
  env,
}) => {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers });
  const userId = session?.user?.id;
  return userId ? { userId } : null;
};

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
    let session: { userId: string } | null = null;
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
  });
}

/** 기본 세션 검증 미들웨어 */
export const requireAuth = createRequireAuth();
