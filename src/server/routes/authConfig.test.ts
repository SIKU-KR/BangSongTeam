import { describe, expect, it } from "vitest";
import {
  AuthConfigResponseSchema,
  SocialProviderSchema,
  type SocialProvider,
} from "#shared";
import type { Db } from "#db";
import { env } from "../test/env";
import app from "../index";
import type { Bindings } from "../types";

const GOOGLE_ONLY: Bindings = {
  ...env,
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
};

const ALL_PROVIDERS: Bindings = {
  ...GOOGLE_ONLY,
  KAKAO_CLIENT_ID: "kakao-id",
  KAKAO_CLIENT_SECRET: "kakao-secret",
  NAVER_CLIENT_ID: "naver-id",
  NAVER_CLIENT_SECRET: "naver-secret",
};

async function configuredProviders(
  bindings: Bindings,
): Promise<SocialProvider[]> {
  const res = await app.request("/api/auth-config", {}, bindings);
  expect(res.status).toBe(200);
  return AuthConfigResponseSchema.parse(await res.json()).providers;
}

async function startSignIn(
  provider: SocialProvider,
  bindings: Bindings,
): Promise<number> {
  const res = await app.request(
    "/api/auth/sign-in/social",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.9.0.${SocialProviderSchema.options.indexOf(provider) + 1}`,
      },
      body: JSON.stringify({ provider, callbackURL: "/" }),
    },
    bindings,
  );
  return res.status;
}

describe("GET /api/auth-config", () => {
  it("id와 secret이 모두 채워진 소셜 로그인만 로그인 화면 순서대로 알려 준다", async () => {
    expect(await configuredProviders(env)).toEqual([]);
    expect(await configuredProviders(GOOGLE_ONLY)).toEqual(["google"]);
    expect(
      await configuredProviders({
        ...GOOGLE_ONLY,
        KAKAO_CLIENT_ID: "kakao-id",
        KAKAO_CLIENT_SECRET: "  ",
      }),
    ).toEqual(["google"]);
    expect(await configuredProviders(ALL_PROVIDERS)).toEqual([
      "kakao",
      "naver",
      "google",
    ]);
  });

  it("알려 준 소셜 로그인만 실제로 로그인을 시작할 수 있다", async () => {
    const listed = await configuredProviders(GOOGLE_ONLY);

    for (const provider of SocialProviderSchema.options) {
      expect(await startSignIn(provider, GOOGLE_ONLY), provider).toBe(
        listed.includes(provider) ? 200 : 404,
      );
    }
  });

  it("세션 없이 Firestore에 가지 않고 캐시 금지로 답한다", async () => {
    const untouchable = new Proxy(
      {},
      {
        get() {
          throw new Error("auth-config must not touch Firestore");
        },
      },
    ) as Db;

    const res = await app.request(
      "/api/auth-config",
      {},
      { ...GOOGLE_ONLY, DB: untouchable },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ providers: ["google"] });
  });
});
