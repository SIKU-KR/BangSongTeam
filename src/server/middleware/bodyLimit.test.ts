import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";
import { createBodyBudget, limitBody } from "./bodyLimit";

const CHUNK_BYTES = 16 * 1024;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function countingBody(totalBytes: number): {
  body: ReadableStream<Uint8Array>;
  pulledBytes: () => number;
} {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = Math.min(CHUNK_BYTES, totalBytes - pulled);
      pulled += size;
      controller.enqueue(new Uint8Array(size).fill(0x30));
      if (pulled >= totalBytes) controller.close();
    },
  });
  return { body, pulledBytes: () => pulled };
}

function post(
  app: Hono<AppEnv>,
  body: BodyInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request("/", {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit),
  );
}

describe("limitBody", () => {
  it("상한 안의 본문은 다음 미들웨어가 그대로 읽는다", async () => {
    const app = new Hono<AppEnv>().post("/", limitBody(16), async (c) =>
      c.text(await c.req.text()),
    );

    const res = await post(app, "hello");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("content-length가 상한을 넘으면 본문을 읽지 않고 413이다", async () => {
    const app = new Hono<AppEnv>().post("/", limitBody(64 * 1024), (c) =>
      c.text("ok"),
    );
    const { body, pulledBytes } = countingBody(3 * 1024 * 1024);

    const res = await post(app, body, {
      "content-length": String(3 * 1024 * 1024),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: API_ERRORS.payloadTooLarge });
    expect(pulledBytes()).toBeLessThanOrEqual(CHUNK_BYTES);
  });

  it("길이를 밝히지 않은 본문은 상한을 넘는 순간 그만 읽고 413이다", async () => {
    const maxBytes = 64 * 1024;
    const app = new Hono<AppEnv>().post("/", limitBody(maxBytes), (c) =>
      c.text("ok"),
    );
    const { body, pulledBytes } = countingBody(3 * 1024 * 1024);

    const res = await post(app, body);

    expect(res.status).toBe(413);
    expect(pulledBytes()).toBeLessThan(maxBytes + 3 * CHUNK_BYTES);
  });

  it("처리 중인 본문 바이트가 예산을 넘으면 503이고, 끝난 본문의 자리는 돌려준다", async () => {
    const budget = createBodyBudget(10);
    const entered = deferred();
    const gate = deferred();
    const app = new Hono<AppEnv>().post(
      "/",
      limitBody(1024, budget),
      async (c) => {
        entered.resolve();
        await gate.promise;
        return c.text("ok");
      },
    );

    const first = post(app, "12345678");
    await entered.promise;
    const busy = await post(app, "12345678");

    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: API_ERRORS.serverBusy });

    gate.resolve();
    expect((await first).status).toBe(200);
    expect((await post(app, "12345678")).status).toBe(200);
  });

  it("처리 중인 본문이 없으면 예산보다 큰 본문도 받는다", async () => {
    const app = new Hono<AppEnv>().post(
      "/",
      limitBody(1024, createBodyBudget(10)),
      async (c) => c.text(String((await c.req.text()).length)),
    );

    const res = await post(app, "x".repeat(100));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("100");
  });

  it("핸들러가 실패해도 잡은 자리를 돌려준다", async () => {
    const app = new Hono<AppEnv>()
      .onError((_, c) => c.text("failed", 500))
      .post("/", limitBody(1024, createBodyBudget(10)), async (c) => {
        if ((await c.req.text()) === "boom1234") throw new Error("boom");
        return c.text("ok");
      });

    expect((await post(app, "boom1234")).status).toBe(500);
    expect((await post(app, "12345678")).status).toBe(200);
  });

  it("본문을 다 받은 뒤에 자리를 잡아, 천천히 보내는 요청이 예산을 붙잡지 못한다", async () => {
    const budget = createBodyBudget(10);
    const app = new Hono<AppEnv>().post(
      "/",
      limitBody(1024, budget),
      async (c) => c.text(await c.req.text()),
    );
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const slow = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
    });

    const slowRes = post(app, slow);
    controller.enqueue(new TextEncoder().encode("1234"));
    const fast = await post(app, "abcdefgh");
    controller.enqueue(new TextEncoder().encode("5678"));
    controller.close();

    expect(fast.status).toBe(200);
    expect(await fast.text()).toBe("abcdefgh");
    expect(await (await slowRes).text()).toBe("12345678");
  });
});
