import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CLIENT_REPORT_MAX_COUNT,
  ClientReportBatchSchema,
  type ClientReportBatch,
} from "#shared";
import {
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "../api/request";
import {
  APP_VERSION,
  __resetClientReportsForTests,
  flushClientReports,
  recordClientFailure,
  reportApiFailure,
} from "./clientReports";

const META = {
  requestId: "4bf92f3577b34da6a3ce929d0e0e4736",
  route: "/api/presentations/:id",
};
const PENDING_KEY = "client-reports-pending";

let sendBeacon: ReturnType<typeof vi.fn>;

function stubBeacon(result = true): void {
  sendBeacon = vi.fn(() => result);
  Object.defineProperty(navigator, "sendBeacon", {
    value: sendBeacon,
    configurable: true,
  });
}

async function sentBatches(): Promise<ClientReportBatch[]> {
  return Promise.all(
    sendBeacon.mock.calls.map(async (call: unknown[]) =>
      ClientReportBatchSchema.parse(JSON.parse(await (call[1] as Blob).text())),
    ),
  );
}

beforeEach(() => {
  __resetClientReportsForTests();
  window.history.replaceState(null, "", "/presentations");
  stubBeacon();
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error 테스트에서 주입한 sendBeacon을 되돌린다
  delete navigator.sendBeacon;
  window.history.replaceState(null, "", "/");
});

describe("reportApiFailure", () => {
  it("타임아웃·닿지 못함·5xx만 담고 4xx·세션 만료는 담지 않는다", async () => {
    reportApiFailure(new TimeoutError(undefined, META));
    reportApiFailure(
      new OfflineError(undefined, { ...META, requestId: "b".repeat(32) }),
    );
    reportApiFailure(
      new ServerRejectedError(503, undefined, undefined, {
        ...META,
        requestId: "c".repeat(32),
      }),
    );
    reportApiFailure(
      new ServerRejectedError(404, undefined, undefined, {
        ...META,
        requestId: "d".repeat(32),
      }),
    );
    reportApiFailure(new SessionExpiredError());
    reportApiFailure(new Error("x"));

    flushClientReports();

    const [batch] = await sentBatches();
    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/client-reports",
      expect.any(Blob),
    );
    expect((sendBeacon.mock.calls[0][1] as Blob).type).toBe("application/json");
    expect(batch).toEqual({
      appVersion: APP_VERSION,
      reports: [
        {
          requestId: META.requestId,
          kind: "timeout",
          route: META.route,
          online: true,
          swControlled: false,
        },
        {
          requestId: "b".repeat(32),
          kind: "unreachable",
          route: META.route,
          online: true,
          swControlled: false,
        },
        {
          requestId: "c".repeat(32),
          kind: "server_error",
          route: META.route,
          online: true,
          swControlled: false,
        },
      ],
    });
  });

  it("요청까지 가지 않은 오류(경로 모름)는 담지 않는다", () => {
    reportApiFailure(new OfflineError());

    flushClientReports();

    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe("flushClientReports", () => {
  it("보낼 것이 없으면 보내지 않고, 보낸 뒤에는 비운다", () => {
    flushClientReports();
    expect(sendBeacon).not.toHaveBeenCalled();

    recordClientFailure({ kind: "stalled", route: "/api/media/*" });
    flushClientReports();
    flushClientReports();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("송출 화면에서는 보내지 않고 남겨 두었다가 다음 화면에서 보낸다", async () => {
    window.history.replaceState(null, "", "/present/abc/fullscreen");
    recordClientFailure({
      kind: "stalled",
      route: "/api/media/*",
      requestId: META.requestId,
    });

    flushClientReports();

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_KEY)).toContain(META.requestId);

    window.history.replaceState(null, "", "/presentations");
    flushClientReports();

    const [batch] = await sentBatches();
    expect(batch.reports).toEqual([
      expect.objectContaining({ kind: "stalled", requestId: META.requestId }),
    ]);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("오프라인이거나 브라우저가 거절하면 남겨 두고 다음에 보낸다", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    recordClientFailure({ kind: "unreachable", route: META.route });
    flushClientReports();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();

    online.mockReturnValue(true);
    stubBeacon(false);
    flushClientReports();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();

    stubBeacon(true);
    flushClientReports();
    const [batch] = await sentBatches();
    expect(batch.reports).toEqual([
      expect.objectContaining({ kind: "unreachable", online: false }),
    ]);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("최근 보고만 상한까지 남기고 같은 보고는 한 번만 담는다", async () => {
    recordClientFailure({ kind: "timeout", ...META });
    recordClientFailure({ kind: "timeout", ...META });
    for (let index = 0; index < CLIENT_REPORT_MAX_COUNT + 5; index += 1) {
      recordClientFailure({
        kind: "server_error",
        route: META.route,
        requestId: index.toString(16).padStart(32, "0"),
      });
    }

    flushClientReports();

    const [batch] = await sentBatches();
    expect(batch.reports).toHaveLength(CLIENT_REPORT_MAX_COUNT);
    expect(batch.reports.some((report) => report.kind === "timeout")).toBe(
      false,
    );
    expect(batch.reports.at(-1)?.requestId).toBe(
      (CLIENT_REPORT_MAX_COUNT + 4).toString(16).padStart(32, "0"),
    );
  });

  it("남겨 둔 값이 깨져 있으면 버리고 새 보고만 보낸다", async () => {
    localStorage.setItem(PENDING_KEY, "{not json");
    recordClientFailure({ kind: "timeout", ...META });

    flushClientReports();

    const [batch] = await sentBatches();
    expect(batch.reports).toHaveLength(1);
  });
});
