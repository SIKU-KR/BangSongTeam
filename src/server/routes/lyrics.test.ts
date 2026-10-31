import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_ERRORS } from "#shared";
import { env } from "../test/env";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

const USER = "aaaaaaaa00000000000l1";

let signedIn = true;
const fakeSession: SessionReader = async () =>
  signedIn ? { userId: USER } : null;

function fixture(name: string): string {
  return readFileSync(
    new URL(`../lib/fixtures/${name}`, import.meta.url),
    "utf8",
  );
}

function get(
  app: ReturnType<typeof createApp>,
  path: string,
  ip = "10.1.0.1",
): Promise<Response> {
  return Promise.resolve(
    app.request(path, { headers: { "x-forwarded-for": ip } }, env),
  );
}

function stubGasazip(
  pages: Record<string, string | number>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const key =
      url.pathname === "/search.html" ? "search" : url.pathname.slice(1);
    const page = pages[key];
    if (typeof page === "number") return new Response("", { status: page });
    if (page === undefined) return new Response("", { status: 404 });
    return new Response(page);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("/api/lyrics", () => {
  afterEach(() => {
    signedIn = true;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("GET /search", () => {
    it("로그인하지 않으면 401이고 gasazip을 부르지 않는다", async () => {
      signedIn = false;
      const fetchMock = stubGasazip({});
      const app = createApp({ readSession: fakeSession });

      const res = await get(app, "/api/lyrics/search?title=%EC%9D%80%ED%98%9C");

      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("후보를 순위대로 돌려주고 응답을 private으로 캐시한다", async () => {
      stubGasazip({ search: fixture("gasazip-search.html") });
      const app = createApp({ readSession: fakeSession });

      const res = await get(
        app,
        `/api/lyrics/search?title=${encodeURIComponent("은혜 위에 은혜")}&artist=${encodeURIComponent("해준")}`,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
      expect(await res.json()).toEqual({
        candidates: [
          { title: "은혜 위에 은혜", artist: "해준", ids: ["2716460"] },
          { title: "은혜 은혜", artist: "정소영", ids: ["3087953"] },
          { title: "은혜 은혜", artist: "박진희", ids: ["3077616"] },
        ],
      });
    });

    it("결과가 없으면 빈 후보 목록이다", async () => {
      stubGasazip({ search: fixture("gasazip-search-none.html") });
      const app = createApp({ readSession: fakeSession });

      const res = await get(app, "/api/lyrics/search?title=zzz");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ candidates: [] });
    });

    it("gasazip이 실패하면 502에 안내 문장을 담는다", async () => {
      stubGasazip({ search: 503 });
      const app = createApp({ readSession: fakeSession });

      const res = await get(app, "/api/lyrics/search?title=%EC%9D%80%ED%98%9C");

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: API_ERRORS.lyrics.unavailable,
      });
    });

    it("빈 제목은 gasazip을 부르지 않고 400이다", async () => {
      const fetchMock = stubGasazip({});
      const app = createApp({ readSession: fakeSession });

      const res = await get(app, "/api/lyrics/search?title=%20");

      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("같은 IP가 1분에 30번을 넘게 검색하면 429다", async () => {
      stubGasazip({ search: fixture("gasazip-search-none.html") });
      const app = createApp({ readSession: fakeSession });

      for (let i = 0; i < 30; i += 1) {
        expect(
          (await get(app, "/api/lyrics/search?title=a", "10.1.0.9")).status,
        ).toBe(200);
      }
      const limited = await get(app, "/api/lyrics/search?title=a", "10.1.0.9");

      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({
        error: API_ERRORS.tooManyRequests,
      });
    });

    it("여러 IP가 보내도 gasazip으로 나가는 요청은 1분에 120건까지다", async () => {
      const fetchMock = stubGasazip({
        search: fixture("gasazip-search-none.html"),
      });
      const app = createApp({ readSession: fakeSession });

      for (let i = 0; i < 120; i += 1) {
        const ip = `10.2.${Math.floor(i / 30)}.${(i % 30) + 1}`;
        expect((await get(app, "/api/lyrics/search?title=a", ip)).status).toBe(
          200,
        );
      }
      const limited = await get(app, "/api/lyrics/search?title=a", "10.3.0.1");

      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).not.toBeNull();
      expect(await limited.json()).toEqual({
        error: API_ERRORS.tooManyRequests,
      });
      expect(fetchMock).toHaveBeenCalledTimes(120);
    });
  });

  describe("GET /song", () => {
    it("로그인하지 않으면 401이다", async () => {
      signedIn = false;
      const app = createApp({ readSession: fakeSession });

      expect((await get(app, "/api/lyrics/song?ids=1")).status).toBe(401);
    });

    it("가사가 빈 번호는 건너뛰고 처음으로 가사가 있는 곡을 돌려준다", async () => {
      const fetchMock = stubGasazip({
        "1": fixture("gasazip-song-empty.html"),
        "2": 404,
        "3": fixture("gasazip-song.html"),
        "4": fixture("gasazip-song-copy-only.html"),
      });
      const app = createApp({ readSession: fakeSession });

      const res = await get(app, "/api/lyrics/song?ids=1,2,3,4");

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
      const body = (await res.json()) as {
        title: string;
        artist: string;
        lyrics: string;
      };
      expect(body.title).toBe("은혜 위에 은혜");
      expect(body.artist).toBe("해준");
      expect(body.lyrics.split("\n")).toHaveLength(7);
      expect(body.lyrics).not.toContain("\n\n");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("모든 번호의 가사가 비면 404다", async () => {
      stubGasazip({ "1": fixture("gasazip-song-empty.html") });
      const app = createApp({ readSession: fakeSession });

      const res = await get(app, "/api/lyrics/song?ids=1,2");

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: API_ERRORS.lyrics.empty });
    });

    it("gasazip이 실패하면 502다", async () => {
      stubGasazip({ "1": 500 });
      const app = createApp({ readSession: fakeSession });

      const res = await get(app, "/api/lyrics/song?ids=1");

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: API_ERRORS.lyrics.unavailable,
      });
    });

    it("숫자가 아니거나 6개를 넘는 ids는 gasazip을 부르지 않고 400이다", async () => {
      const fetchMock = stubGasazip({});
      const app = createApp({ readSession: fakeSession });

      for (const ids of ["abc", "1,../2", "", "1,2,3,4,5,6"]) {
        const res = await get(
          app,
          `/api/lyrics/song?ids=${encodeURIComponent(ids)}`,
        );
        expect(res.status).toBe(400);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
