import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetServerClockForTests,
  noteServerClock,
  serverAlignedNow,
} from "./serverClock";

const DEVICE_NOW = Date.parse("2026-10-28T09:50:00.000Z");
const MINUTE = 60_000;

function headers(date: string, cacheControl?: string): Headers {
  const result = new Headers({ date });
  if (cacheControl) result.set("cache-control", cacheControl);
  return result;
}

describe("서버에 맞춘 지금 시각", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DEVICE_NOW);
    __resetServerClockForTests();
  });

  afterEach(() => {
    __resetServerClockForTests();
    vi.useRealTimers();
  });

  it("서버 시계를 모르면 기기 시계다", () => {
    noteServerClock(undefined);
    noteServerClock(new Headers());

    expect(serverAlignedNow()).toBe(DEVICE_NOW);
  });

  it("기기 시계가 서버보다 늦으면 응답의 Date 헤더로 잰 서버 시계를 쓰고, 그 초의 끝까지로 본다", () => {
    noteServerClock(headers("Wed, 28 Oct 2026 10:00:00 GMT"));

    expect(serverAlignedNow()).toBe(DEVICE_NOW + 10 * MINUTE + 1000);

    vi.advanceTimersByTime(MINUTE);
    expect(serverAlignedNow()).toBe(DEVICE_NOW + 11 * MINUTE + 1000);
  });

  it("기기 시계가 서버와 Date 헤더의 정밀도(1초) 안이거나 서버보다 빠르면 기기 시계 그대로다", () => {
    noteServerClock(headers("Wed, 28 Oct 2026 09:50:00 GMT"));
    expect(serverAlignedNow()).toBe(DEVICE_NOW);

    noteServerClock(headers("Wed, 28 Oct 2026 09:40:00 GMT"));
    expect(serverAlignedNow()).toBe(DEVICE_NOW);
  });

  it("나중 응답이 잰 차이를 따르고, 읽지 못하는 Date 헤더는 무시한다", () => {
    noteServerClock(headers("Wed, 28 Oct 2026 10:00:00 GMT"));
    noteServerClock(headers("yesterday"));
    expect(serverAlignedNow()).toBe(DEVICE_NOW + 10 * MINUTE + 1000);

    noteServerClock(headers("Wed, 28 Oct 2026 09:50:00 GMT"));
    expect(serverAlignedNow()).toBe(DEVICE_NOW);
  });

  it("캐시에 둘 수 있는 응답의 Date 헤더는 지난 시각일 수 있어 재지 않는다", () => {
    noteServerClock(headers("Wed, 28 Oct 2026 10:00:00 GMT"));
    noteServerClock(
      headers("Wed, 28 Oct 2026 09:30:00 GMT", "public, max-age=60"),
    );
    noteServerClock(
      headers("Wed, 28 Oct 2026 09:30:00 GMT", "public, immutable"),
    );

    expect(serverAlignedNow()).toBe(DEVICE_NOW + 10 * MINUTE + 1000);
  });
});
