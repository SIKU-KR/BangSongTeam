import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth/types";
import { z } from "zod";
import { API_ERRORS, DEV_USERS } from "#shared";

/** 개발용 로그인 뒤 돌아갈 화면 */
export const DEV_SIGN_IN_REDIRECT = "/presentations";

/**
 * OAuth 클라이언트 없이 시드 계정(`DEV_USERS`)으로 로그인하는 Better Auth 플러그인.
 * `GET /api/auth/dev/sign-in?userId=<id>`가 세션 쿠키를 심고 드라이브로 보낸다.
 *
 * `getAuth`가 `import.meta.env.DEV`일 때만 등록하므로 `vite build` 결과(운영 Worker)에는
 * 이 엔드포인트가 없다. 시드 계정 id만 받으므로 `CF_REMOTE_BINDINGS=true`로 운영 D1에
 * 붙인 개발 서버에서도 실제 사용자로 들어갈 수 없다.
 */
export function devSignIn(): BetterAuthPlugin {
  return {
    id: "dev-sign-in",
    endpoints: {
      devSignIn: createAuthEndpoint(
        "/dev/sign-in",
        {
          method: "GET",
          query: z.object({ userId: z.string().optional() }),
        },
        async (ctx) => {
          const userId = ctx.query.userId ?? DEV_USERS[0].id;
          const user = DEV_USERS.some((dev) => dev.id === userId)
            ? await ctx.context.internalAdapter.findUserById(userId)
            : null;
          if (!user) {
            throw new APIError("NOT_FOUND", {
              message: API_ERRORS.userNotFound,
            });
          }
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          await setSessionCookie(ctx, { session, user });
          throw ctx.redirect(DEV_SIGN_IN_REDIRECT);
        },
      ),
    },
  };
}
