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
});
