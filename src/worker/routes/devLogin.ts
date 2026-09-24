import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DevLoginRequestSchema } from "#shared";
import type { AppEnv } from "../types";
import {
  createAuth,
  isDevLoginEnabled,
  configuredSocialProviders,
} from "../lib/auth";

/**
 * 개발자 로그인.
 *
 * 카카오·네이버 앱 등록은 Redirect URI에 실제 도메인이 필요하다. 도메인 구입
 * 전까지 이 경로로 로그인해 전체 기능을 쓴다 (2026-09-22 결정).
 *
 * **가짜 세션을 만들지 않는다.** Better Auth의 비밀번호 로그인을 그대로 써서
 * 진짜 세션·쿠키를 발급한다. 그래야 나머지 코드가 OAuth 로그인과 똑같이
 * 동작하고, 나중에 OAuth를 붙일 때 지금 한 검증이 무효가 되지 않는다.
 */

/** 개발용 고정 비밀번호. localhost에서만 통하므로 비밀이 아니다. */
const DEV_PASSWORD = "worship-dev-password-0000";
/**
 * 개발용 기본 계정.
 *
 * `dev@localhost`는 better-auth의 이메일 검증(도메인에 점 필요)을 통과하지
 * 못한다. `.local`은 실제로 등록될 수 없는 예약 TLD라 충돌 위험이 없다.
 */
const DEFAULT_DEV_EMAIL = "dev@worship.local";

const devLoginRoute = new Hono<AppEnv>()
  .get("/auth-config", (c) => {
    return c.json(
      {
        providers: configuredSocialProviders(c.env),
        devLogin: isDevLoginEnabled(c.env, c.req.url),
      },
      200,
    );
  })
  .post("/dev-login", zValidator("json", DevLoginRequestSchema), async (c) => {
    if (!isDevLoginEnabled(c.env, c.req.url)) {
      return c.json({ error: "Not Found" }, 404);
    }

    const { email = DEFAULT_DEV_EMAIL, name } = c.req.valid("json");
    const auth = createAuth(c.env);
    const credentials = { email, password: DEV_PASSWORD };

    const signIn = await auth.api
      .signInEmail({ body: credentials, asResponse: true })
      .catch(() => null);

    if (signIn && signIn.status < 400) return signIn;

    return await auth.api.signUpEmail({
      body: { ...credentials, name: name ?? email.split("@")[0] },
      asResponse: true,
    });
  });

export { devLoginRoute, DEV_PASSWORD, DEFAULT_DEV_EMAIL };
export default devLoginRoute;
