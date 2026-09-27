import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../index";
import type { Bindings } from "../types";

const NO_PROVIDERS: Bindings = {
  ...env,
  KAKAO_CLIENT_ID: "",
  KAKAO_CLIENT_SECRET: "",
  NAVER_CLIENT_ID: "",
  NAVER_CLIENT_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
};

async function providers(bindings: Bindings): Promise<string[]> {
  const res = await app.request("/api/auth-config", {}, bindings);
  return ((await res.json()) as { providers: string[] }).providers;
}

describe("auth-config", () => {
  it("자격증명이 설정된 소셜 프로바이더만 알려 준다", async () => {
    expect(await providers(NO_PROVIDERS)).toEqual([]);
    expect(
      await providers({
        ...NO_PROVIDERS,
        KAKAO_CLIENT_ID: "real-id",
        KAKAO_CLIENT_SECRET: "real-secret",
      }),
    ).toEqual(["kakao"]);
    expect(
      await providers({
        ...NO_PROVIDERS,
        KAKAO_CLIENT_ID: "real-id",
        KAKAO_CLIENT_SECRET: "real-secret",
        NAVER_CLIENT_ID: "real-id",
        NAVER_CLIENT_SECRET: "real-secret",
        GOOGLE_CLIENT_ID: "real-id",
        GOOGLE_CLIENT_SECRET: "real-secret",
      }),
    ).toEqual(["kakao", "naver", "google"]);
  });

  it("비밀번호 로그인·가입 경로는 열려 있지 않다", async () => {
    for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-up/email"]) {
      const res = await app.request(
        path,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: env.BETTER_AUTH_URL ?? "",
          },
          body: JSON.stringify({
            email: "team@example.com",
            password: "password-1234",
            name: "찬양팀",
          }),
        },
        NO_PROVIDERS,
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token/);
    }
  });
});
