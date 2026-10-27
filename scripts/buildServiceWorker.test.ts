import { describe, it, expect, vi, afterEach } from "vitest";
import * as vm from "node:vm";
import {
  collectShells,
  shellWorkerSource,
  OFFLINE_RSC_PREFIX,
  RSC_NETWORK_TIMEOUT_MS,
  SHELL_REFRESH_TIMEOUT_MS,
} from "./buildServiceWorker.mjs";
import { OFFLINE_SHELL_PARAM } from "../src/shared/constants/projection";

const P = OFFLINE_SHELL_PARAM;
const ORIGIN = "https://x.test";
const PRECACHE = `workbox-precache-v2-${ORIGIN}/`;
const BUILD_ID = "build-1";

const SHELLS = collectShells(
  {
    "/presentations": { dataRoute: "/presentations.rsc" },
    "/terms": { dataRoute: "/terms.rsc" },
    [`/editor/${P}`]: { dataRoute: `/editor/${P}.rsc` },
    [`/present/${P}/fullscreen`]: { dataRoute: `/present/${P}/fullscreen.rsc` },
  },
  P,
);

const PROJECTION_RSC = `0:{"c":["","present","${P}","fullscreen"],"q":"","t":{"s":{"n":"presentationId","t":"d","k":"${P}","s":[]}},"b":"${BUILD_ID}"}\n`;

function shellHtml(buildId: string, param: string | null = P): string {
  const route =
    param === null ? "" : `[\\"presentationId\\",\\"${param}\\",\\"d\\"]`;
  return `<!DOCTYPE html><script>self.__next_f.push([1,"${route}{\\"b\\":\\"${buildId}\\"}"])</script>`;
}

const EDITOR_HTML = shellHtml(BUILD_ID);
const TERMS_HTML = shellHtml(BUILD_ID, null);

const PRECACHED: Record<string, string> = {
  [`${OFFLINE_RSC_PREFIX}/present/${P}/fullscreen.rsc`]: PROJECTION_RSC,
  [`${OFFLINE_RSC_PREFIX}/presentations.rsc`]: '0:{"c":["","presentations"]}\n',
  [`/editor/${P}`]: EDITOR_HTML,
  "/terms": TERMS_HTML,
};

interface FakeRequest {
  mode: string;
  method: string;
  url: string;
  headers: Headers;
}

type FetchListener = (event: {
  request: FakeRequest;
  respondWith: (response: Response | Promise<Response>) => void;
}) => void;

type Network = (
  input: FakeRequest | string,
  init?: RequestInit,
) => Promise<Response>;

const precacheKey = (path: string): string =>
  `${ORIGIN}${path}?__WB_REVISION__=r1`;

function fakePrecache(bodies: Record<string, string>): Map<string, string> {
  return new Map(
    Object.entries(bodies).map(([path, body]) => [precacheKey(path), body]),
  );
}

function startShellWorker(
  network: Network,
  precached: Record<string, string> | Map<string, string> = PRECACHED,
): (request: FakeRequest) => Promise<Response> | undefined {
  const listeners: FetchListener[] = [];
  const entries =
    precached instanceof Map ? precached : fakePrecache(precached);
  const keysFor = (url: string): string[] =>
    [...entries.keys()].filter(
      (key) => new URL(key).pathname === new URL(url).pathname,
    );
  const context = vm.createContext({
    self: {
      registration: { scope: `${ORIGIN}/` },
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: FetchListener) => {
        if (type === "fetch") listeners.push(listener);
      },
    },
    caches: {
      match: async (url: string, options: { cacheName: string }) => {
        const [key] = keysFor(url);
        if (options.cacheName !== PRECACHE || key === undefined) {
          return undefined;
        }
        return new Response(entries.get(key), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
      open: async (name: string) => {
        if (name !== PRECACHE) throw new Error(`unexpected cache ${name}`);
        return {
          keys: async (url: string, options: { ignoreSearch?: boolean }) =>
            options.ignoreSearch
              ? keysFor(url).map((key) => ({ url: key }))
              : [],
          put: async (request: { url: string }, response: Response) => {
            entries.set(request.url, await response.text());
          },
        };
      },
    },
    fetch: network,
    Headers,
    Response,
    URL,
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  });
  vm.runInContext(shellWorkerSource(SHELLS, P, BUILD_ID), context);

  return (request) => {
    let response: Promise<Response> | undefined;
    for (const listener of listeners) {
      listener({
        request,
        respondWith: (value) => {
          response = Promise.resolve(value);
        },
      });
    }
    return response;
  };
}

function rscRequest(
  path: string,
  headers: Record<string, string> = {},
  overrides: Partial<FakeRequest> = {},
): FakeRequest {
  return {
    mode: "cors",
    method: "GET",
    url: `${ORIGIN}${path}`,
    headers: new Headers({ RSC: "1", ...headers }),
    ...overrides,
  };
}

const offline = (): Promise<Response> =>
  Promise.reject(new TypeError("Failed to fetch"));

describe("서비스 워커의 화면 안 이동(RSC 요청)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("오프라인이면 미리 받아 둔 셸 RSC에 주소의 id를 넣어 답한다", async () => {
    const handle = startShellWorker(offline);

    const response = await handle(rscRequest("/present/abc/fullscreen?_rsc=1"));

    expect(response).toBeDefined();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type")).toBe("text/x-component");
    const body = await response!.text();
    expect(body).toContain('"k":"abc"');
    expect(body).toContain('"c":["","present","abc","fullscreen"]');
    expect(body).not.toContain(P);
  });

  it("동적 자리가 없는 화면은 셸 RSC를 그대로 쓴다", async () => {
    const handle = startShellWorker(offline);

    const response = await handle(rscRequest("/presentations?_rsc=2"));

    expect(await response!.text()).toBe('0:{"c":["","presentations"]}\n');
  });

  it("연결돼 있으면 서버가 준 RSC 응답을 그대로 쓴다", async () => {
    const fromServer = new Response("0:{}", {
      headers: { "content-type": "text/x-component" },
    });
    const network = vi.fn(async () => fromServer);
    const handle = startShellWorker(network);
    const request = rscRequest("/present/abc/fullscreen?_rsc=1");

    expect(await handle(request)).toBe(fromServer);
    expect(network).toHaveBeenCalledWith(request);
  });

  it("서버가 RSC가 아닌 응답(오류 페이지)을 주면 셸 RSC로 답해 화면을 새로 불러오지 않는다", async () => {
    const handle = startShellWorker(
      async () =>
        new Response("<html>Worker exceeded limits</html>", {
          status: 503,
          headers: { "content-type": "text/html" },
        }),
    );

    const response = await handle(rscRequest("/present/abc/fullscreen?_rsc=1"));

    expect(response!.headers.get("content-type")).toBe("text/x-component");
    expect(await response!.text()).toContain('"k":"abc"');
  });

  it("연결은 됐는데 서버가 답하지 않으면 제한 시간 뒤 셸 RSC로 답한다", async () => {
    vi.useFakeTimers();
    const handle = startShellWorker(() => new Promise<Response>(() => {}));

    const response = handle(rscRequest("/present/abc/fullscreen?_rsc=1"));
    let settled = false;
    void response!.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(RSC_NETWORK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await (await response!).text()).toContain('"k":"abc"');
  });

  it("셸 RSC를 받아 두지 못했으면 네트워크 결과를 그대로 돌려준다", async () => {
    const handle = startShellWorker(offline, {});

    const response = await handle(rscRequest("/present/abc/fullscreen?_rsc=1"));

    expect(response!.type).toBe("error");
  });

  it.each([
    ["미리 받기", rscRequest("/editor/abc", { "Next-Router-Prefetch": "1" })],
    [
      "조각 미리 받기",
      rscRequest("/editor/abc", { "Next-Router-Segment-Prefetch": "/_tree" }),
    ],
    ["RSC가 아닌 요청", rscRequest("/editor/abc", { RSC: "0" })],
    ["셸이 없는 주소", rscRequest("/unknown")],
    ["API", rscRequest("/api/presentations")],
    ["POST", rscRequest("/editor/abc", {}, { method: "POST" })],
    [
      "다른 출처",
      rscRequest("/editor/abc", {}, { url: "https://other.test/editor/abc" }),
    ],
  ])("%s 요청에는 답하지 않는다", (_label, request) => {
    const handle = startShellWorker(offline);

    expect(handle(request)).toBeUndefined();
  });

  it("주소창 이동(navigate)은 지금처럼 셸 HTML에 주소의 id를 넣어 답한다", async () => {
    const network = vi.fn(offline);
    const handle = startShellWorker(network);

    const response = await handle({
      mode: "navigate",
      method: "GET",
      url: `${ORIGIN}/editor/abc`,
      headers: new Headers(),
    });

    expect(await response!.text()).toContain('\\"abc\\"');
    expect(network).not.toHaveBeenCalled();
  });
});

describe("서비스 워커의 주소창 이동(셸 HTML)과 배포 중 섞인 셸", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function navigate(path: string): FakeRequest {
    return {
      mode: "navigate",
      method: "GET",
      url: `${ORIGIN}${path}`,
      headers: new Headers(),
    };
  }

  function html(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  it("빌드 id 없이는 셸 핸들러를 만들지 않는다", () => {
    expect(() => shellWorkerSource(SHELLS, P, "")).toThrow();
  });

  it("미리 받아 둔 셸이 이 서비스 워커의 빌드면 서버에 묻지 않고 그대로 답한다", async () => {
    const network = vi.fn(offline);
    const handle = startShellWorker(network);

    const response = await handle(navigate("/terms"));

    expect(await response!.text()).toBe(TERMS_HTML);
    expect(network).not.toHaveBeenCalled();
  });

  it("배포 중 이전 빌드의 셸이 담겼으면 서버에서 셸을 다시 받아 그것으로 답하고 프리캐시를 고친다", async () => {
    const fresh = TERMS_HTML;
    const network = vi.fn(async () => html(fresh));
    const precache = fakePrecache({ "/terms": shellHtml("build-0", null) });
    const handle = startShellWorker(network, precache);

    const response = await handle(navigate("/terms?from=menu"));

    expect(await response!.text()).toBe(fresh);
    expect(network).toHaveBeenCalledWith(`${ORIGIN}/terms`, {
      cache: "reload",
    });
    expect(precache.get(precacheKey("/terms"))).toBe(fresh);
  });

  it("동적 경로는 자리표시 셸을 다시 받아 프리캐시를 고치고, 주소의 id를 넣어 답한다", async () => {
    const network = vi.fn(async () => html(EDITOR_HTML));
    const precache = fakePrecache({ [`/editor/${P}`]: shellHtml("build-0") });
    const handle = startShellWorker(network, precache);

    const response = await handle(navigate("/editor/abc"));

    expect(await response!.text()).toBe(shellHtml(BUILD_ID, "abc"));
    expect(network).toHaveBeenCalledWith(`${ORIGIN}/editor/${P}`, {
      cache: "reload",
    });
    expect(precache.get(precacheKey(`/editor/${P}`))).toBe(EDITOR_HTML);
  });

  it("서버가 또 다른 빌드의 셸을 주면 그것으로 답하되 프리캐시는 고치지 않는다", async () => {
    const stale = shellHtml("build-0", null);
    const newer = shellHtml("build-2", null);
    const precache = fakePrecache({ "/terms": stale });
    const handle = startShellWorker(async () => html(newer), precache);

    const response = await handle(navigate("/terms"));

    expect(await response!.text()).toBe(newer);
    expect(precache.get(precacheKey("/terms"))).toBe(stale);
  });

  it.each([
    ["서버에 닿지 못하면", offline],
    ["서버가 오류로 답하면", async () => html("<html>error</html>", 503)],
  ])(
    "%s 미리 받아 둔 셸로 답해 오프라인에서도 앱이 뜨게 한다",
    async (_label, network) => {
      const stale = shellHtml("build-0");
      const precache = fakePrecache({ [`/editor/${P}`]: stale });
      const handle = startShellWorker(network, precache);

      const response = await handle(navigate("/editor/abc"));

      expect(await response!.text()).toBe(shellHtml("build-0", "abc"));
      expect(precache.get(precacheKey(`/editor/${P}`))).toBe(stale);
    },
  );

  it("셸을 다시 받는 응답이 늦으면 제한 시간 뒤 미리 받아 둔 셸로 답한다", async () => {
    vi.useFakeTimers();
    const stale = shellHtml("build-0", null);
    const handle = startShellWorker(
      () => new Promise<Response>(() => {}),
      fakePrecache({ "/terms": stale }),
    );

    const response = handle(navigate("/terms"));
    let settled = false;
    void response!.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(SHELL_REFRESH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await (await response!).text()).toBe(stale);
  });
});
