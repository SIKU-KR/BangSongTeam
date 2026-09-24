import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { EmailSignUpRequestSchema } from "#shared";
import type { AppEnv } from "../types";
import {
  createAuth,
  isEmailLoginEnabled,
  isEmailSignupAllowed,
} from "../lib/auth";

/**
 * 이메일·비밀번호 가입.
 *
 * 카카오·네이버 자격증명이 없는 동안 배포 환경에서 로그인할 수 있게 연다. 메일
 * 인증이 없으므로 Better Auth 공개 가입 경로는 닫아 두고, 허용 목록에 있는
 * 주소만 이 경로로 받는다. 성공 응답은 Better Auth 응답 그대로라 세션 쿠키가
 * 함께 내려간다. 이미 가입된 주소는 Better Auth가 422로 거절한다.
 */
export const emailSignupRoute = new Hono<AppEnv>().post(
  "/email-signup",
  zValidator("json", EmailSignUpRequestSchema),
  async (c) => {
    if (!isEmailLoginEnabled(c.env)) {
      return c.json({ error: "Not Found" }, 404);
    }

    const body = c.req.valid("json");
    if (!isEmailSignupAllowed(c.env, body.email)) {
      return c.json({ error: "가입이 허용되지 않은 이메일입니다" }, 403);
    }

    return await createAuth(c.env).api.signUpEmail({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  },
);

export default emailSignupRoute;
