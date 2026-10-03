import { describe, it, expect } from "vitest";
import {
  BASE_BACKOFF_MS,
  calculateBackoffWithJitter,
  getRetryDelay,
  BackoffTracker,
} from "./backoff";
import { OfflineError, ServerRejectedError } from "../api/request";

describe("calculateBackoffWithJitter", () => {
  it("random이 1일 때 지수적으로 2배씩 증가한다", () => {
    expect(calculateBackoffWithJitter(0, 2000, 60_000, 1)).toBe(2000);
    expect(calculateBackoffWithJitter(1, 2000, 60_000, 1)).toBe(4000);
    expect(calculateBackoffWithJitter(2, 2000, 60_000, 1)).toBe(8000);
    expect(calculateBackoffWithJitter(3, 2000, 60_000, 1)).toBe(16_000);
    expect(calculateBackoffWithJitter(4, 2000, 60_000, 1)).toBe(32_000);
    expect(calculateBackoffWithJitter(5, 2000, 60_000, 1)).toBe(60_000);
    expect(calculateBackoffWithJitter(6, 2000, 60_000, 1)).toBe(60_000);
  });

  it("최대 상한(MAX_BACKOFF_MS)을 넘지 않는다", () => {
    expect(calculateBackoffWithJitter(10, 2000, 60_000, 1)).toBe(60_000);
  });

  it("random이 0이면 0을 돌려준다", () => {
    expect(calculateBackoffWithJitter(3, 2000, 60_000, 0)).toBe(0);
  });

  it("random이 0과 1 사이일 때 비례한 값을 돌려준다", () => {
    // attempt 1: temp = 4000. 0.5 * 4000 = 2000
    expect(calculateBackoffWithJitter(1, 2000, 60_000, 0.5)).toBe(2000);
  });
});

describe("getRetryDelay", () => {
  it("Retry-After 헤더가 있는 ServerRejectedError는 헤더 값을 우선한다", () => {
    const errorWithHeader = new ServerRejectedError(503, "과부하", 5000);
    expect(getRetryDelay(errorWithHeader, 0, 1)).toBe(5000);
    expect(getRetryDelay(errorWithHeader, 5, 0.5)).toBe(5000);
  });

  it("Retry-After가 없는 에러는 지수 백오프를 따른다", () => {
    const offline = new OfflineError();
    expect(getRetryDelay(offline, 0, 1)).toBe(BASE_BACKOFF_MS);
    expect(getRetryDelay(offline, 1, 1)).toBe(BASE_BACKOFF_MS * 2);
  });
});

describe("BackoffTracker", () => {
  it("호출마다 attempt가 증가하고 reset 시 초기화된다", () => {
    const tracker = new BackoffTracker();
    tracker.__setRandomForTests(() => 1);

    expect(tracker.currentAttempt).toBe(0);
    expect(tracker.getDelay(new OfflineError())).toBe(2000);
    expect(tracker.currentAttempt).toBe(1);
    expect(tracker.getDelay(new OfflineError())).toBe(4000);
    expect(tracker.currentAttempt).toBe(2);

    tracker.reset();
    expect(tracker.currentAttempt).toBe(0);
    expect(tracker.getDelay(new OfflineError())).toBe(2000);
  });
});
