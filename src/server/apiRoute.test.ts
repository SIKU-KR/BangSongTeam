import { afterEach, describe, expect, it, vi } from "vitest";
import { API_ERRORS } from "#shared";
import { PROXY_CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from "./lib/clientIp";

const SECRET = "route-proxy-secret";

async function loadRoute(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import("../app/api/[[...route]]/route");
}

function direct(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.run.app${path}`, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API 라우트의 프록시 강제", () => {
  it("REQUIRE_PROXY를 켜면 프록시 비밀값이 맞는 요청만 앱에 넘긴다", async () => {
    const { GET } = await loadRoute({
      PROXY_SECRET: SECRET,
      REQUIRE_PROXY: "1",
    });

    const noSecret = await GET(direct("/api/media/missing.mp4"));
    expect(noSecret.status).toBe(403);
    expect(await noSecret.json()).toEqual({ error: API_ERRORS.proxyRequired });

    const wrongSecret = await GET(
      direct("/api/media/missing.mp4", { [PROXY_SECRET_HEADER]: "wrong" }),
    );
    expect(wrongSecret.status).toBe(403);

    const proxied = await GET(
      direct("/api/media/missing.mp4", {
        [PROXY_SECRET_HEADER]: SECRET,
        [PROXY_CLIENT_IP_HEADER]: "192.0.2.10",
      }),
    );
    expect(proxied.status).toBe(404);
  });

  it("켜 두어도 /api/health는 비밀값 없이 답한다", async () => {
    const { GET, HEAD } = await loadRoute({
      PROXY_SECRET: SECRET,
      REQUIRE_PROXY: "true",
    });

    expect((await GET(direct("/api/health"))).status).toBe(200);
    expect((await HEAD(direct("/api/health"))).status).toBe(200);
  });

  it.each([undefined, "", "0", "false"])(
    "REQUIRE_PROXY가 %j이면 비밀값 없는 요청도 받는다",
    async (flag) => {
      const { GET } = await loadRoute({
        PROXY_SECRET: SECRET,
        REQUIRE_PROXY: flag,
      });

      expect((await GET(direct("/api/media/missing.mp4"))).status).toBe(404);
    },
  );
});
