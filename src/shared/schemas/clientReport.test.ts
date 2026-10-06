import { describe, it, expect } from "vitest";
import {
  CLIENT_REPORT_MAX_COUNT,
  ClientReportBatchSchema,
} from "./clientReport";

const REPORT = {
  requestId: "4bf92f3577b34da6a3ce929d0e0e4736",
  kind: "server_error",
  route: "/api/presentations/:id",
  online: true,
  swControlled: false,
};

function batch(reports: unknown[]): unknown {
  return { appVersion: "dev", reports };
}

describe("ClientReportBatchSchema", () => {
  it("최소한의 묶음을 받는다", () => {
    expect(ClientReportBatchSchema.safeParse(batch([REPORT])).success).toBe(
      true,
    );
    const { requestId, ...withoutId } = REPORT;
    void requestId;
    expect(
      ClientReportBatchSchema.safeParse(
        batch([{ ...withoutId, route: "/api/media/*" }]),
      ).success,
    ).toBe(true);
  });

  it("보고가 비었거나 상한을 넘으면 거절한다", () => {
    expect(ClientReportBatchSchema.safeParse(batch([])).success).toBe(false);
    expect(
      ClientReportBatchSchema.safeParse(
        batch(
          Array.from({ length: CLIENT_REPORT_MAX_COUNT + 1 }, () => REPORT),
        ),
      ).success,
    ).toBe(false);
  });

  it("모르는 필드는 보고에도 묶음에도 받지 않는다", () => {
    expect(
      ClientReportBatchSchema.safeParse(batch([{ ...REPORT, message: "x" }]))
        .success,
    ).toBe(false);
    expect(
      ClientReportBatchSchema.safeParse({
        ...(batch([REPORT]) as object),
        x: 1,
      }).success,
    ).toBe(false);
  });

  it("16진수 32자리가 아닌 상관 ID와 id가 섞인 경로를 거절한다", () => {
    for (const report of [
      { ...REPORT, requestId: "8a1b2c3d-ICN" },
      { ...REPORT, requestId: "4BF92F3577B34DA6A3CE929D0E0E4736" },
      { ...REPORT, route: "/api/presentations/V1StGXR8_Z5jdHi6B-myT" },
      { ...REPORT, route: "/presentations/:id" },
      { ...REPORT, route: "/api/share/s_abc?x=1" },
    ]) {
      expect(ClientReportBatchSchema.safeParse(batch([report])).success).toBe(
        false,
      );
    }
  });

  it("앱 버전 형식을 제한한다", () => {
    expect(
      ClientReportBatchSchema.safeParse({ appVersion: "", reports: [REPORT] })
        .success,
    ).toBe(false);
    expect(
      ClientReportBatchSchema.safeParse({
        appVersion: "<script>",
        reports: [REPORT],
      }).success,
    ).toBe(false);
  });
});
