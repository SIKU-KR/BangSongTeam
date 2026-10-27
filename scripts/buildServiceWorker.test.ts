import { describe, it, expect, vi, afterEach } from "vitest";
import * as vm from "node:vm";
import {
  collectShells,
  shellWorkerSource,
  OFFLINE_RSC_PREFIX,
  RSC_NETWORK_TIMEOUT_MS,
} from "./buildServiceWorker.mjs";
import { OFFLINE_SHELL_PARAM } from "../src/shared/constants/projection";

const P = OFFLINE_SHELL_PARAM;
const ORIGIN = "https://x.test";
const PRECACHE = `workbox-precache-v2-${ORIGIN}/`;

const SHELLS = collectShells(
  {
    "/presentations": { dataRoute: "/presentations.rsc" },
    [`/editor/${P}`]: { dataRoute: `/editor/${P}.rsc` },
    [`/present/${P}/fullscreen`]: { dataRoute: `/present/${P}/fullscreen.rsc` },
  },
  P,
);

const PROJECTION_RSC = `0:{"c":["","present","${P}","fullscreen"],"q":"","t":{"s":{"n":"presentationId","t":"d","k":"${P}","s":[]}},"b":"build-1"}\n`;
const EDITOR_HTML = `<!DOCTYPE html><script>self.__next_f.push([1,"[\\"presentationId\\",\\"${P}\\",\\"d\\"]"])</script>`;

const PRECACHED: Record<string, string> = {
  [`${OFFLINE_RSC_PREFIX}/present/${P}/fullscreen.rsc`]: PROJECTION_RSC,
  [`${OFFLINE_RSC_PREFIX}/presentations.rsc`]: '0:{"c":["","presentations"]}\n',
  [`/editor/${P}`]: EDITOR_HTML,
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

function startShellWorker(
  network: (request: FakeRequest) => Promise<Response>,
  precached: Record<string, string> = PRECACHED,
): (request: FakeRequest) => Promise<Response> | undefined {
  const listeners: FetchListener[] = [];
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
        const body = precached[new URL(url).pathname];
        if (options.cacheName !== PRECACHE || body === undefined) {
          return undefined;
        }
        return new Response(body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
    fetch: network,
    Headers,
    Response,
    URL,
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  });
  vm.runInContext(shellWorkerSource(SHELLS, P), context);

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
