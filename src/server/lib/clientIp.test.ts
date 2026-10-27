import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { API_ERRORS } from "#shared";
import {
  __resetProxySecretWarningForTests,
  clientIp,
  lastForwardedIp,
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  rateLimitKey,
  rejectUnproxied,
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

describe("lastForwardedIp", () => {
  const forwarded = (value: string) =>
    new Headers({ "x-forwarded-for": value });

  it("앞단이 마지막에 붙인 값을 읽어, 클라이언트가 앞에 적은 값은 쓰지 않는다", () => {
    expect(lastForwardedIp(forwarded("10.0.9.9, 203.0.113.9 "))).toBe(
      "203.0.113.9",
    );
    expect(lastForwardedIp(forwarded("192.0.2.10"))).toBe("192.0.2.10");
  });

  it("프록시를 거친 요청은 프록시가 넘긴 IP를 읽는다", () => {
    const request = withTrustedClientIp(
      proxied({
        [PROXY_SECRET_HEADER]: SECRET,
        [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
      }),
      SECRET,
    );

    expect(lastForwardedIp(request.headers)).toBe("192.0.2.10");
  });

  it("헤더가 없거나 마지막 값이 비면 unknown이다", () => {
    expect(lastForwardedIp(new Headers())).toBe("unknown");
    expect(lastForwardedIp(forwarded("10.0.9.9, "))).toBe("unknown");
  });
});

describe("rateLimitKey", () => {
  it("IPv4와 IP가 아닌 값은 그대로 쓴다", () => {
    expect(rateLimitKey("198.51.100.7")).toBe("198.51.100.7");
    expect(rateLimitKey("unknown")).toBe("unknown");
  });

  it("IPv6는 같은 /64 대역이면 같은 키로 묶는다", () => {
    const key = rateLimitKey("2001:db8:abcd:12::1");

    expect(rateLimitKey("2001:DB8:ABCD:0012:ffff:ffff:ffff:fffe")).toBe(key);
    expect(rateLimitKey("2001:db8:abcd:12:a::")).toBe(key);
    expect(rateLimitKey("2001:db8:abcd:13::1")).not.toBe(key);
    expect(rateLimitKey("2001:db8::abcd:12:0:0:1")).not.toBe(key);
  });

  it("IPv4를 담은 IPv6는 IPv4로 센다", () => {
    expect(rateLimitKey("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitKey("::FFFF:c000:201")).toBe("192.0.2.1");
    expect(rateLimitKey("64:ff9b::192.0.2.1")).toBe(rateLimitKey("64:ff9b::1"));
  });

  it("IPv6 영역 표시(%)는 떼고 세어 쌍점이 든 영역에도 예외 없이 같은 /64로 묶는다", () => {
    expect(rateLimitKey("1:2:3:4:5:6:7:8%a:b")).toBe(
      rateLimitKey("1:2:3:4::1"),
    );
    expect(rateLimitKey("1:2:3:4::1%eth0")).toBe(rateLimitKey("1:2:3:4::1"));
    expect(rateLimitKey("fe80::1%a:b:c:d:e:f:g:h")).toBe(
      rateLimitKey("fe80::1"),
    );
    expect(rateLimitKey("::1%:1:2:3:4:5:6:7:8:9")).toBe(rateLimitKey("::1"));
    expect(rateLimitKey("::ffff:192.0.2.1%x:y")).toBe("192.0.2.1");
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

describe("rejectUnproxied", () => {
  const required = { PROXY_SECRET: SECRET, REQUIRE_PROXY: true };

  function direct(path: string, headers: Record<string, string> = {}) {
    return new Request(`https://example.run.app${path}`, { headers });
  }

  it.each([
    ["프록시 비밀값이 없으면", {}],
    ["프록시 비밀값이 틀리면", { [PROXY_SECRET_HEADER]: "wrong" }],
  ])("켜 두면 %s 403으로 막고 캐시하지 못하게 한다", async (_, headers) => {
    const response = rejectUnproxied(
      direct("/api/media/loops/a.mp4", headers),
      required,
    );

    expect(response?.status).toBe(403);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    await expect(response?.json()).resolves.toEqual({
      error: API_ERRORS.proxyRequired,
    });
  });

  it("프록시 비밀값이 맞으면 통과시킨다", () => {
    expect(
      rejectUnproxied(
        direct("/api/media/loops/a.mp4", { [PROXY_SECRET_HEADER]: SECRET }),
        required,
      ),
    ).toBeNull();
  });

  it.each(["/api/health", "/api/health?probe=1"])(
    "%s는 비밀값 헤더가 없으면 통과시킨다",
    (path) => {
      expect(rejectUnproxied(direct(path), required)).toBeNull();
    },
  );

  it.each([
    ["틀리면", "wrong"],
    ["비어 있으면", ""],
  ])(
    "/api/health도 비밀값 헤더가 %s 막아 Worker와 어긋난 비밀값이 가동 확인에 드러난다",
    (_, secret) => {
      const response = rejectUnproxied(
        direct("/api/health", { [PROXY_SECRET_HEADER]: secret }),
        required,
      );

      expect(response?.status).toBe(403);
    },
  );

  it("/api/health는 비밀값이 맞아도 통과시킨다", () => {
    expect(
      rejectUnproxied(
        direct("/api/health", { [PROXY_SECRET_HEADER]: SECRET }),
        required,
      ),
    ).toBeNull();
  });

  it.each(["/api/healthz", "/api/health/extra", "/api/backgrounds"])(
    "%s는 비밀값이 없으면 막는다",
    (path) => {
      expect(rejectUnproxied(direct(path), required)?.status).toBe(403);
    },
  );

  it.each([
    ["플래그가 꺼져 있으면", { PROXY_SECRET: SECRET }],
    [
      "플래그를 명시적으로 껐으면",
      { PROXY_SECRET: SECRET, REQUIRE_PROXY: false },
    ],
    ["서버에 비밀값이 없으면", { REQUIRE_PROXY: true }],
  ])("%s 아무것도 막지 않는다", (_, env) => {
    expect(rejectUnproxied(direct("/api/media/loops/a.mp4"), env)).toBeNull();
  });
});
