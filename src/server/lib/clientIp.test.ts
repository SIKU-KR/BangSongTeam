import { describe, it, expect } from "vitest";
import {
  clientIp,
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  withTrustedClientIp,
} from "./clientIp";

const SECRET = "proxy-secret-for-tests";

function proxied(headers: Record<string, string>, init: RequestInit = {}) {
  return new Request("https://example.run.app/api/auth/sign-in/email", {
    ...init,
    headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.9", ...headers },
  });
}

describe("withTrustedClientIp", () => {
  it("비밀값이 맞으면 프록시가 넘긴 IP 하나로 x-forwarded-for를 바꾼다", () => {
    const request = withTrustedClientIp(
      proxied({
        [PROXY_SECRET_HEADER]: SECRET,
        [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
      }),
      SECRET,
    );

    expect(request.headers.get("x-forwarded-for")).toBe("192.0.2.10");
    expect(clientIp(request.headers)).toBe("192.0.2.10");
    expect(request.headers.has(PROXY_SECRET_HEADER)).toBe(false);
    expect(request.headers.has(PROXY_CLIENT_IP_HEADER)).toBe(false);
  });

  it("비밀값이 틀리면 IP를 믿지 않고 프록시 헤더만 지운다", () => {
    const request = withTrustedClientIp(
      proxied({
        [PROXY_SECRET_HEADER]: "wrong",
        [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
      }),
      SECRET,
    );

    expect(request.headers.get("x-forwarded-for")).toBe(
      "198.51.100.7, 203.0.113.9",
    );
    expect(request.headers.has(PROXY_SECRET_HEADER)).toBe(false);
    expect(request.headers.has(PROXY_CLIENT_IP_HEADER)).toBe(false);
  });

  it("서버에 비밀값이 없으면 프록시 헤더를 믿지 않는다", () => {
    const request = withTrustedClientIp(
      proxied({
        [PROXY_SECRET_HEADER]: "",
        [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
      }),
      undefined,
    );

    expect(request.headers.get("x-forwarded-for")).toBe(
      "198.51.100.7, 203.0.113.9",
    );
  });

  it("프록시 헤더가 없는 요청은 그대로 넘긴다", () => {
    const original = proxied({});

    expect(withTrustedClientIp(original, SECRET)).toBe(original);
  });

  it("헤더를 바꿔도 요청 본문은 그대로 남는다", async () => {
    const request = withTrustedClientIp(
      proxied(
        {
          [PROXY_SECRET_HEADER]: SECRET,
          [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
          "content-type": "application/json",
        },
        { method: "POST", body: JSON.stringify({ email: "a@example.com" }) },
      ),
      SECRET,
    );

    expect(request.method).toBe("POST");
    await expect(request.json()).resolves.toEqual({ email: "a@example.com" });
  });
});
