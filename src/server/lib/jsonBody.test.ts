import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";
import { jsonBody } from "./jsonBody";

function post(app: Hono<AppEnv>, body: string): Promise<Response> {
  return Promise.resolve(
    app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

describe("jsonBody", () => {
  it("맞는 본문은 기본값을 채우고 모르는 필드를 지워 핸들러에 넘긴다", async () => {
    const schema = z.object({
      name: z.string(),
      tags: z.array(z.string()).default([]),
    });
    const app = new Hono<AppEnv>().post("/", jsonBody(schema, 1024), (c) =>
      c.json(c.req.valid("json")),
    );

    const res = await post(app, JSON.stringify({ name: "곡", extra: 1 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "곡", tags: [] });
  });

  it("틀린 본문은 첫 문제에서 검사를 멈추고 짧은 400으로 답한다", async () => {
    let checkedAfterFirstIssue = 0;
    const schema = z.object({
      items: z.array(
        z.object({ n: z.number() }).refine(() => {
          checkedAfterFirstIssue += 1;
          return true;
        }),
      ),
    });
    const app = new Hono<AppEnv>().post(
      "/",
      jsonBody(schema, 1024 * 1024),
      (c) => c.text("ok"),
    );
    const items = [{}, ...Array.from({ length: 1_000 }, () => ({ n: 1 }))];

    const res = await post(app, JSON.stringify({ items }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: API_ERRORS.idMismatch });
    expect(checkedAfterFirstIssue).toBe(0);
  });

  it("상한을 넘는 본문은 검사하지 않고 413이다", async () => {
    const app = new Hono<AppEnv>().post(
      "/",
      jsonBody(z.object({ name: z.string() }), 16),
      (c) => c.text("ok"),
    );

    const res = await post(app, JSON.stringify({ name: "x".repeat(32) }));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: API_ERRORS.payloadTooLarge });
  });

  it("틀린 본문은 onInvalid가 준 응답으로 답하고, onInvalid가 넘기면 400이다", async () => {
    const seen: unknown[] = [];
    const app = new Hono<AppEnv>().post(
      "/",
      jsonBody(z.object({ name: z.string().max(3) }), 1024, (body, c) => {
        seen.push(body);
        return (body as { name?: unknown }).name === "너무 긴 이름"
          ? c.json({ error: "too long" }, 413)
          : undefined;
      }),
      (c) => c.text("ok"),
    );

    const tooLong = await post(app, JSON.stringify({ name: "너무 긴 이름" }));
    const wrongType = await post(app, JSON.stringify({ name: 1 }));
    const valid = await post(app, JSON.stringify({ name: "곡" }));

    expect(tooLong.status).toBe(413);
    expect(await tooLong.json()).toEqual({ error: "too long" });
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toEqual({ error: API_ERRORS.idMismatch });
    expect(valid.status).toBe(200);
    expect(seen).toEqual([{ name: "너무 긴 이름" }, { name: 1 }]);
  });

  it("짝을 잃은 서로게이트는 검사 전에 U+FFFD로 바꿔 넘기고, 온전한 이모지는 그대로 둔다", async () => {
    const schema = z.object({
      title: z.string().max(2),
      songs: z.array(z.object({ lines: z.array(z.string()) })),
    });
    const app = new Hono<AppEnv>().post("/", jsonBody(schema, 1024), (c) =>
      c.json(c.req.valid("json")),
    );

    const res = await post(
      app,
      JSON.stringify({
        title: "곡\uD83D",
        songs: [{ lines: ["\uDE00끝", "😀\uD83D😀"] }],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      title: "곡\uFFFD",
      songs: [{ lines: ["\uFFFD끝", "😀\uFFFD😀"] }],
    });
  });

  it("틀린 본문도 반쪽을 바꾼 뒤에 onInvalid에 넘긴다", async () => {
    const seen: unknown[] = [];
    const app = new Hono<AppEnv>().post(
      "/",
      jsonBody(z.object({ name: z.string().max(1) }), 1024, (body) => {
        seen.push(body);
        return undefined;
      }),
      (c) => c.text("ok"),
    );

    const res = await post(app, JSON.stringify({ name: "곡\uD83D" }));

    expect(res.status).toBe(400);
    expect(seen).toEqual([{ name: "곡\uFFFD" }]);
  });

  it("아주 깊이 겹친 본문도 스택을 넘기지 않고 검사해 400으로 답한다", async () => {
    const depth = 200_000;
    const app = new Hono<AppEnv>().post(
      "/",
      jsonBody(z.object({ name: z.string() }), 1024 * 1024),
      (c) => c.text("ok"),
    );

    const res = await post(
      app,
      `${"[".repeat(depth)}{"name":"\\ud83d"}${"]".repeat(depth)}`,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: API_ERRORS.idMismatch });
  });
});
