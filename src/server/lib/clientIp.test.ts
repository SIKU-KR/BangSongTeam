import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  __resetProxySecretWarningForTests,
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

describe("프록시 비밀값 불일치 경고", () => {
  let log: ReturnType<typeof vi.spyOn>;

  function warnings(): Record<string, unknown>[] {
    return log.mock.calls
      .map((call: unknown[]) => JSON.parse(call[0] as string))
      .filter(
        (line: Record<string, unknown>) =>
          line.event === "proxy_secret_mismatch",
      );
  }

  beforeEach(() => {
    __resetProxySecretWarningForTests();
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("비밀값이 틀린 프록시 요청은 프로세스마다 한 번만 WARNING으로 남기고 헤더는 믿지 않는다", () => {
    const forged = () =>
      withTrustedClientIp(
        proxied({
          [PROXY_SECRET_HEADER]: "wrong-secret-value",
          [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
        }),
        SECRET,
      );

    const first = forged();
    forged();

    expect(warnings()).toEqual([
      {
        severity: "WARNING",
        event: "proxy_secret_mismatch",
        configured: true,
      },
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("wrong-secret-value");
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    expect(first.headers.get("x-forwarded-for")).toBe(
      "198.51.100.7, 203.0.113.9",
    );
  });

  it("서버에 비밀값이 없는데 프록시 헤더가 오면 설정되지 않았다고 남긴다", () => {
    withTrustedClientIp(
      proxied({
        [PROXY_SECRET_HEADER]: SECRET,
        [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
      }),
      undefined,
    );

    expect(warnings()).toEqual([
      {
        severity: "WARNING",
        event: "proxy_secret_mismatch",
        configured: false,
      },
    ]);
  });

  it("비밀값이 맞거나 프록시 헤더가 없으면 남기지 않는다", () => {
    withTrustedClientIp(
      proxied({
        [PROXY_SECRET_HEADER]: SECRET,
        [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
      }),
      SECRET,
    );
    withTrustedClientIp(proxied({}), SECRET);

    expect(warnings()).toEqual([]);
  });
});
