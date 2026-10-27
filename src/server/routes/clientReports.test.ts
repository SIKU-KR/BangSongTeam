import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "../test/env";
import { API_ERRORS, CLIENT_REPORT_MAX_BYTES } from "#shared";
import { createApp } from "../index";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(
      "/api/client-reports",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      env,
    ),
  );
}

const validBatch = {
  appVersion: "abc1234",
  reports: [
    {
      requestId: TRACE_ID,
      kind: "timeout",
      route: "/api/presentations/:id",
      online: true,
      swControlled: true,
    },
    {
      requestId: OTHER_TRACE_ID,
      kind: "stalled",
      route: "/api/media/*",
      online: true,
      swControlled: false,
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/client-reports", () => {
  it("올바른 묶음은 204로 받고 보고마다 client_report 로그를 한 줄 남긴다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    const res = await post(app, validBatch);

    expect(res.status).toBe(204);
    const reportId = res.headers.get("x-request-id");
    const lines = log.mock.calls
      .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
      .filter((line) => line.event === "client_report");
    expect(lines).toEqual([
      {
        severity: "INFO",
        event: "client_report",
        requestId: TRACE_ID,
        reportRequestId: reportId,
        kind: "timeout",
        route: "/api/presentations/:id",
        online: true,
        swControlled: true,
        appVersion: "abc1234",
      },
      {
        severity: "INFO",
        event: "client_report",
        requestId: OTHER_TRACE_ID,
        reportRequestId: reportId,
        kind: "stalled",
        route: "/api/media/*",
        online: true,
        swControlled: false,
        appVersion: "abc1234",
      },
    ]);
  });

  it("허용하지 않은 필드·갈래·경로는 400으로 거절한다", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();
    const [report] = validBatch.reports;

    const invalid = [
      { ...validBatch, reports: [{ ...report, lyrics: "가사" }] },
      { ...validBatch, reports: [{ ...report, kind: "crash" }] },
      {
        ...validBatch,
        reports: [{ ...report, route: "/api/presentations/AbC123" }],
      },
      { ...validBatch, extra: true },
    ];
    for (const body of invalid) {
      expect((await post(app, body)).status).toBe(400);
    }
  });

  it("크기 제한을 넘는 본문은 413이다", async () => {
    const app = createApp();

    const res = await post(app, "x".repeat(CLIENT_REPORT_MAX_BYTES + 1));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: API_ERRORS.payloadTooLarge,
    });
  });

  it("JSON이 아닌 본문은 서버 오류가 아니라 400이고 오류 로그를 남기지 않는다", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();

    for (const body of ["{", "{not json"]) {
      const res = await post(app, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: API_ERRORS.idMismatch });
    }
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("같은 IP가 창 안에서 한도를 넘으면 429다", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();
    const headers = { "x-forwarded-for": "203.0.113.7" };

    for (let index = 0; index < 30; index += 1) {
      expect((await post(app, validBatch, headers)).status).toBe(204);
    }
    const limited = await post(app, validBatch, headers);
    const otherIp = await post(app, validBatch, {
      "x-forwarded-for": "203.0.113.8",
    });

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: API_ERRORS.tooManyRequests,
    });
    expect(otherIp.status).toBe(204);
  });

  it("빈도 제한에 걸린 보고는 본문을 읽지 않고 429다", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();
    const headers = { "x-forwarded-for": "203.0.113.9" };
    for (let index = 0; index < 30; index += 1) {
      expect((await post(app, validBatch, headers)).status).toBe(204);
    }
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 16 * 1024;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
        if (pulled >= 3 * 1024 * 1024) controller.close();
      },
    });

    const res = await app.request(
      "/api/client-reports",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        duplex: "half",
      } as RequestInit,
      env,
    );

    expect(res.status).toBe(429);
    expect(pulled).toBeLessThan(CLIENT_REPORT_MAX_BYTES * 8);
  });
});
