import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { DrizzleQueryError } from "drizzle-orm";
import { Hono } from "hono";
import { createApp } from "../index";
import type { SessionReader } from "./auth";
import type { AppEnv } from "../types";
import { describeError, logServerError } from "../lib/requestLog";
import { requestLog, resolveRequestId } from "./requestLog";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;
const USER_ID = "aaaaaaaa00000000000r1";

const fakeSession: SessionReader = async () => ({ userId: USER_ID });

interface LoggedLine {
  event?: string;
  requestId?: string;
  cfRay?: string | null;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  userHash?: string;
  error?: { message: string; cause?: { message: string } };
  [key: string]: unknown;
}

function logLines(spy: ReturnType<typeof vi.spyOn>): LoggedLine[] {
  return spy.mock.calls.map((call: unknown[]) => call[0] as LoggedLine);
}

function requestLines(spy: ReturnType<typeof vi.spyOn>): LoggedLine[] {
  return logLines(spy).filter((line) => line.event === "request");
}

beforeAll(async () => {
  await env.MEDIA_BUCKET.put(
    "loops/warm_light_flow.mp4",
    new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    { httpMetadata: { contentType: "video/mp4" } },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveRequestId", () => {
  it("올바른 traceparent의 trace-id를 쓴다", () => {
    expect(resolveRequestId(new Headers({ traceparent: TRACEPARENT }))).toBe(
      TRACE_ID,
    );
  });

  it("형식이 틀리거나 trace-id가 모두 0이면 cf-ray로 돌아간다", () => {
    for (const traceparent of [
      "garbage",
      `00-${"0".repeat(32)}-00f067aa0ba902b7-01`,
      `00-${TRACE_ID.toUpperCase()}-00f067aa0ba902b7-01`,
    ]) {
      expect(
        resolveRequestId(
          new Headers({ traceparent, "cf-ray": "8a1b2c3d-ICN" }),
        ),
      ).toBe("8a1b2c3d-ICN");
    }
  });

  it("둘 다 없으면 32자리 무작위 16진수를 만든다", () => {
    const first = resolveRequestId(new Headers());
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(resolveRequestId(new Headers())).not.toBe(first);
  });
});

describe("describeError", () => {
  it("D1 오류를 감싼 cause 사슬의 이름과 메시지를 남긴다", () => {
    const d1 = new Error("D1_ERROR: UNIQUE constraint failed: decks.id");
    const wrapped = new Error("wrapped", { cause: d1 });

    const described = describeError(wrapped);

    expect(described).toMatchObject({
      name: "Error",
      message: "wrapped",
      cause: {
        name: "Error",
        message: "D1_ERROR: UNIQUE constraint failed: decks.id",
      },
    });
    expect(JSON.parse(JSON.stringify(described)).cause.message).toContain(
      "D1_ERROR",
    );
  });

  it("Drizzle 쿼리 오류는 SQL 문과 원인만 남기고 바인딩 값(가사)은 남기지 않는다", () => {
    const d1 = new Error("D1_ERROR: UNIQUE constraint failed: decks.id");
    const query = 'insert into "decks" ("id", "slides") values (?, ?)';
    const wrapped = new DrizzleQueryError(
      query,
      ["deck-1", JSON.stringify({ lyrics: "주 하나님 지으신 모든 세계" })],
      d1,
    );

    const described = describeError(wrapped);

    expect(described).toMatchObject({
      name: "DrizzleQueryError",
      message: `Failed query: ${query}`,
      cause: { message: "D1_ERROR: UNIQUE constraint failed: decks.id" },
    });
    expect(described).not.toHaveProperty("stack");
    expect(JSON.stringify(described)).not.toContain("주 하나님");
  });

  it("cause는 3단계까지만 따라간다", () => {
    let err = new Error("level 0");
    for (let level = 1; level <= 5; level += 1) {
      err = new Error(`level ${level}`, { cause: err });
    }
    let depth = 0;
    let current = describeError(err);
    while (current.cause) {
      current = current.cause;
      depth += 1;
    }
    expect(depth).toBe(3);
  });
});

describe("logServerError", () => {
  it("상관 ID·라우트 패턴·요약 값만 남기고 요청 본문은 남기지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = new Hono<AppEnv>()
      .use("*", requestLog())
      .put("/api/things/:id", async (c) => {
        const body = await c.req.text();
        logServerError(
          c,
          "thing upsert failed",
          new DrizzleQueryError(
            "insert into things values (?)",
            [body],
            new Error("D1_ERROR: busy"),
          ),
          { thingId: c.req.param("id"), songCount: 3 },
        );
        return c.json({ error: "x" }, 500);
      });

    const res = await app.request(
      "/api/things/abc",
      {
        method: "PUT",
        headers: { traceparent: TRACEPARENT },
        body: JSON.stringify({ lyrics: "주 하나님 지으신 모든 세계" }),
      },
      env,
    );

    expect(res.status).toBe(500);
    const line = logLines(error).find(
      (entry) => entry.event === "thing upsert failed",
    );
    expect(line).toMatchObject({
      requestId: TRACE_ID,
      route: "/api/things/:id",
      thingId: "abc",
      songCount: 3,
      error: { cause: { message: "D1_ERROR: busy" } },
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("주 하나님");
  });
});

describe("requestLog 미들웨어", () => {
  it("traceparent의 trace-id를 x-request-id로 돌려주고 요청 로그를 한 줄 남긴다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    const res = await app.request(
      "/api/health",
      { headers: { traceparent: TRACEPARENT, "cf-ray": "8a1b2c3d-ICN" } },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(TRACE_ID);
    const lines = requestLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "request",
      requestId: TRACE_ID,
      cfRay: "8a1b2c3d-ICN",
      method: "GET",
      route: "/api/health",
      status: 200,
    });
    expect(typeof lines[0].durationMs).toBe("number");
    expect(lines[0]).not.toHaveProperty("userHash");
  });

  it("traceparent가 없으면 cf-ray를, 그것도 없으면 무작위 ID를 쓴다", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    const withRay = await app.request(
      "/api/health",
      { headers: { "cf-ray": "8a1b2c3d-ICN" } },
      env,
    );
    const bare = await app.request("/api/health", {}, env);

    expect(withRay.headers.get("x-request-id")).toBe("8a1b2c3d-ICN");
    expect(bare.headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("404와 Response를 직접 돌려주는 미디어 응답에도 x-request-id를 붙인다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    const missing = await app.request("/api/unknown-path", {}, env);
    const media = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      { headers: { traceparent: TRACEPARENT, Range: "bytes=0-4" } },
      env,
    );

    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/);
    expect(media.status).toBe(206);
    expect(media.headers.get("x-request-id")).toBe(TRACE_ID);
    expect(media.headers.get("content-range")).toBe("bytes 0-4/10");
    expect((await media.arrayBuffer()).byteLength).toBe(5);
    const mediaLine = requestLines(log).find(
      (line) => line.requestId === TRACE_ID,
    );
    expect(mediaLine).toMatchObject({ route: "/api/media/*", status: 206 });
    expect(JSON.stringify(log.mock.calls)).not.toContain("warm_light_flow");
  });

  it("경로는 라우트 패턴으로, 사용자는 해시로 남긴다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp({ readSession: fakeSession });
    const id = "1000000000000000000rl";

    const res = await app.request(
      `/api/presentations/${id}`,
      { headers: { traceparent: TRACEPARENT } },
      env,
    );

    expect(res.status).toBe(404);
    const [line] = requestLines(log);
    expect(line.route).toBe("/api/presentations/:id");
    expect(line.userHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(log.mock.calls)).not.toContain(USER_ID);
    expect(JSON.stringify(log.mock.calls)).not.toContain(id);
  });

  it("처리되지 않은 오류는 일반 500 본문을 주고 원인을 console.error로 남긴다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const brokenBucket = {
      get: async () => {
        throw new Error("R2 internal: bangsongteam-media unreachable");
      },
    } as unknown as R2Bucket;

    const res = await createApp().request(
      "/api/media/loops/warm_light_flow.mp4",
      { headers: { traceparent: TRACEPARENT } },
      { ...env, MEDIA_BUCKET: brokenBucket },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    expect(res.headers.get("x-request-id")).toBe(TRACE_ID);
    expect(requestLines(log)).toHaveLength(0);
    const [line] = requestLines(error);
    expect(line).toMatchObject({
      requestId: TRACE_ID,
      route: "/api/media/*",
      status: 500,
    });
    expect(line.error?.message).toContain("R2 internal");
  });
});
