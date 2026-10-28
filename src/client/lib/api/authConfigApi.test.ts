import { describe, it, expect, afterEach } from "vitest";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { fetchAuthConfig } from "./authConfigApi";

describe("fetchAuthConfig", () => {
  let api: FakeApi | null = null;

  afterEach(() => api?.restore());

  it("서버가 켜 둔 소셜 로그인 목록을 읽는다", async () => {
    api = installFakeApi({
      "GET /api/auth-config": () => ({ body: { providers: ["google"] } }),
    });

    expect(await fetchAuthConfig()).toEqual({ providers: ["google"] });
    expect(api.calls).toEqual([
      expect.objectContaining({ method: "GET", path: "/api/auth-config" }),
    ]);
  });

  it("알아볼 수 없는 로그인 방법이 섞인 응답은 받지 못한 것으로 본다", async () => {
    api = installFakeApi({
      "GET /api/auth-config": () => ({
        body: { providers: ["google", "apple"] },
      }),
    });

    await expect(fetchAuthConfig()).rejects.toThrow();
  });

  it("서버가 거절하면 던진다", async () => {
    api = installFakeApi({
      "GET /api/auth-config": () => ({ status: 503, body: {} }),
    });

    await expect(fetchAuthConfig()).rejects.toThrow();
  });
});
