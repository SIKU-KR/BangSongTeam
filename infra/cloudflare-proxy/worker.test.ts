import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import proxy from "./worker.js";

type UpstreamInit = RequestInit & { cf?: { cacheEverything: boolean } };

const ENV = { ORIGIN_HOST: "o.run.app", PROXY_SECRET: "s" };

let upstream: Mock<(input: URL, init: UpstreamInit) => Promise<Response>>;

function stubUpstream(response: () => Response = () => new Response("ok")) {
  upstream = vi.fn(async () => response());
  vi.stubGlobal("fetch", upstream);
}

function upstreamCall(): { url: string; init: UpstreamInit; headers: Headers } {
  expect(upstream).toHaveBeenCalledTimes(1);
  const [url, init] = upstream.mock.calls[0];
  return { url: url.toString(), init, headers: new Headers(init.headers) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloudflare Worker 프록시", () => {
  it("같은 경로·쿼리로 run.app에 요청하고 프록시 헤더는 클라이언트가 보낸 값을 덮어쓴다", async () => {
    stubUpstream();
    await proxy.fetch(
      new Request(
        "https://pub.example/api/auth/callback/google?code=c&state=st",
        {
          headers: {
            "x-bst-proxy-secret": "forged",
            "x-bst-client-ip": "6.6.6.6",
            "cf-connecting-ip": "1.2.3.4",
          },
        },
      ),
      ENV,
    );

    const { url, init, headers } = upstreamCall();
    expect(url).toBe(
      "https://o.run.app/api/auth/callback/google?code=c&state=st",
    );
    expect(headers.get("x-bst-proxy-secret")).toBe("s");
    expect(headers.get("x-bst-client-ip")).toBe("1.2.3.4");
    expect(headers.get("x-forwarded-host")).toBe("pub.example");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(init.redirect).toBe("manual");
  });

  it("Cloudflare가 사용자 IP를 주지 않으면 클라이언트가 보낸 IP도 넘기지 않는다", async () => {
    stubUpstream();
    await proxy.fetch(
      new Request("https://pub.example/api/auth/sign-in/email", {
        method: "POST",
        headers: { "x-bst-client-ip": "6.6.6.6" },
      }),
      ENV,
    );

    expect(upstreamCall().headers.get("x-bst-client-ip")).toBe("");
  });

  it("run.app을 가리키는 location은 공개 도메인으로 바꾼다", async () => {
    stubUpstream(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://o.run.app/login?x=1" },
        }),
    );
    const response = await proxy.fetch(
      new Request("https://pub.example/api/auth/callback/google"),
      ENV,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://pub.example/login?x=1",
    );
  });

  it("다른 곳을 가리키는 location은 그대로 둔다", async () => {
    const location = "https://accounts.google.com/o/oauth2/v2/auth?state=st";
    stubUpstream(
      () => new Response(null, { status: 302, headers: { location } }),
    );
    const response = await proxy.fetch(
      new Request("https://pub.example/api/auth/sign-in/social", {
        method: "POST",
      }),
      ENV,
    );

    expect(response.headers.get("location")).toBe(location);
  });

  it.each(["GET", "HEAD"])(
    "%s /api/media/*는 Cloudflare에 캐시한다",
    async (method) => {
      stubUpstream();
      await proxy.fetch(
        new Request("https://pub.example/api/media/loops/a.mp4", { method }),
        ENV,
      );

      expect(upstreamCall().init.cf).toEqual({ cacheEverything: true });
    },
  );

  it.each(["GET", "HEAD"])(
    "%s /api/media/*는 쿼리 문자열을 떼고 요청해 캐시 키에 쿼리가 남지 않는다",
    async (method) => {
      stubUpstream();
      await proxy.fetch(
        new Request("https://pub.example/api/media/loops/a.mp4?r=1&v=x", {
          method,
        }),
        ENV,
      );

      const { url, init } = upstreamCall();
      expect(url).toBe("https://o.run.app/api/media/loops/a.mp4");
      expect(init.cf).toEqual({ cacheEverything: true });
    },
  );

  it("쿼리만 다른 미디어 요청은 같은 주소로 원본에 요청한다", async () => {
    stubUpstream();
    const fetchWith = (query: string) =>
      proxy.fetch(
        new Request(`https://pub.example/api/media/posters/p.webp${query}`),
        ENV,
      );

    await fetchWith("");
    await fetchWith("?r=1");
    await fetchWith("?r=2");

    expect(upstream.mock.calls.map(([url]) => url.toString())).toEqual([
      "https://o.run.app/api/media/posters/p.webp",
      "https://o.run.app/api/media/posters/p.webp",
      "https://o.run.app/api/media/posters/p.webp",
    ]);
  });

  it.each([
    ["GET", "/api/catalog/search?q=x"],
    ["GET", "/api/backgrounds?page=2"],
    ["POST", "/api/media/loops/a.mp4?r=1"],
  ])("%s %s는 캐시하지 않고 쿼리도 그대로 둔다", async (method, target) => {
    stubUpstream();
    await proxy.fetch(
      new Request(`https://pub.example${target}`, { method }),
      ENV,
    );

    const { url, init } = upstreamCall();
    expect(url).toBe(`https://o.run.app${target}`);
    expect(init.cf).toBeUndefined();
  });

  it.each([
    ["GET", "/api/backgrounds"],
    ["POST", "/api/media/loops/a.mp4"],
  ])("%s %s는 캐시하지 않는다", async (method, pathname) => {
    stubUpstream();
    await proxy.fetch(
      new Request(`https://pub.example${pathname}`, { method }),
      ENV,
    );

    expect(upstreamCall().init.cf).toBeUndefined();
  });

  it("쓰기 요청의 메서드와 본문을 그대로 넘긴다", async () => {
    stubUpstream();
    await proxy.fetch(
      new Request("https://pub.example/api/presentations/p1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: '{"title":"t"}',
      }),
      ENV,
    );

    const { init, headers } = upstreamCall();
    expect(init.method).toBe("PUT");
    expect(headers.get("content-type")).toBe("application/json");
    expect(await new Response(init.body).text()).toBe('{"title":"t"}');
  });
});
