import { describe, it, expect } from "vitest";
import {
  MAX_CLOCK_SKEW_MS,
  clampToClock,
  editTimestamp,
  isFarFuture,
  isOutdatedWrite,
  laterThan,
} from "./timestamps";

const NOW = Date.parse("2026-10-27T09:00:00.000Z");
const at = (ms: number): string => new Date(ms).toISOString();

describe("MAX_CLOCK_SKEW_MS", () => {
  it("5분이다", () => {
    expect(MAX_CLOCK_SKEW_MS).toBe(5 * 60_000);
  });
});

describe("laterThan", () => {
  it("앞 판보다 늦은 시각은 그대로 쓴다", () => {
    expect(laterThan(at(NOW), at(NOW + 1))).toBe(at(NOW + 1));
  });

  it("앞 판과 같거나 이른 시각이면 앞 판 + 1ms다", () => {
    expect(laterThan(at(NOW), at(NOW))).toBe(at(NOW + 1));
    expect(laterThan(at(NOW), at(NOW - 60_000))).toBe(at(NOW + 1));
  });

  it("앞 판이 없으면 그대로 쓴다", () => {
    expect(laterThan(null, at(NOW))).toBe(at(NOW));
    expect(laterThan(undefined, at(NOW - 1))).toBe(at(NOW - 1));
  });
});

describe("clampToClock", () => {
  it("서버 시계 + 5분까지는 그대로 둔다", () => {
    expect(clampToClock(at(NOW - 60_000), NOW)).toBe(at(NOW - 60_000));
    expect(clampToClock(at(NOW + MAX_CLOCK_SKEW_MS), NOW)).toBe(
      at(NOW + MAX_CLOCK_SKEW_MS),
    );
  });

  it("그보다 늦으면 서버 시계 + 5분으로 줄인다", () => {
    expect(clampToClock(at(NOW + MAX_CLOCK_SKEW_MS + 1), NOW)).toBe(
      at(NOW + MAX_CLOCK_SKEW_MS),
    );
    expect(clampToClock("9999-12-31T00:00:00.000Z", NOW)).toBe(
      at(NOW + MAX_CLOCK_SKEW_MS),
    );
  });
});

describe("editTimestamp", () => {
  it("시계가 앞 판보다 늦으면 지금이다", () => {
    expect(editTimestamp(at(NOW - 60_000), NOW)).toBe(at(NOW));
    expect(editTimestamp(null, NOW)).toBe(at(NOW));
  });

  it("서버가 찍은 앞 판보다 시계가 뒤처지면 앞 판 + 1ms다", () => {
    expect(editTimestamp(at(NOW + 2 * 60_000), NOW)).toBe(
      at(NOW + 2 * 60_000 + 1),
    );
  });

  it("앞 판이 9999년이면 지금 + 5분 + 1ms로 줄인다", () => {
    expect(editTimestamp("9999-12-31T00:00:00.000Z", NOW)).toBe(
      at(NOW + MAX_CLOCK_SKEW_MS + 1),
    );
  });
});

describe("isFarFuture", () => {
  it("지금 + 10분을 넘을 때만 참이다", () => {
    expect(isFarFuture(at(NOW + 2 * MAX_CLOCK_SKEW_MS), NOW)).toBe(false);
    expect(isFarFuture(at(NOW + 2 * MAX_CLOCK_SKEW_MS + 1), NOW)).toBe(true);
    expect(isFarFuture(at(NOW + MAX_CLOCK_SKEW_MS + 1), NOW)).toBe(false);
    expect(isFarFuture("9999-12-31T00:00:00.000Z", NOW)).toBe(true);
  });
});

describe("isOutdatedWrite", () => {
  it("저장본이 들어온 판보다 늦으면 참이다", () => {
    expect(isOutdatedWrite(at(NOW - 1_000), at(NOW - 2_000), NOW)).toBe(true);
  });

  it("같은 시각이나 더 늦은 쓰기는 거르지 않는다", () => {
    expect(isOutdatedWrite(at(NOW - 1_000), at(NOW - 1_000), NOW)).toBe(false);
    expect(isOutdatedWrite(at(NOW - 2_000), at(NOW - 1_000), NOW)).toBe(false);
  });

  it("서버 시계 + 5분을 넘는 저장본은 막지 않는다", () => {
    expect(isOutdatedWrite(at(NOW + MAX_CLOCK_SKEW_MS), at(NOW), NOW)).toBe(
      true,
    );
    expect(isOutdatedWrite(at(NOW + MAX_CLOCK_SKEW_MS + 1), at(NOW), NOW)).toBe(
      false,
    );
    expect(isOutdatedWrite("9999-12-31T00:00:00.000Z", at(NOW), NOW)).toBe(
      false,
    );
  });
});
