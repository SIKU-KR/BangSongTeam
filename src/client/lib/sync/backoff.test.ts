import { describe, it, expect } from "vitest";
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  calculateBackoffWithJitter,
  getRetryDelay,
  BackoffTracker,
} from "./backoff";
import {
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "../api/request";

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
    expect(calculateBackoffWithJitter(1, 2000, 60_000, 0.5)).toBe(2000);
  });
});

describe("getRetryDelay", () => {
  it("Retry-After를 바닥으로 삼고, 시도할수록 늘어나는 백오프가 더 길면 그만큼 기다린다", () => {
    const errorWithHeader = new ServerRejectedError(503, "과부하", 5000);
    expect(getRetryDelay(errorWithHeader, 0, 1)).toBe(5000);
    expect(getRetryDelay(errorWithHeader, 5, 0.5)).toBe(30_000);
  });

  it("서버가 늘 같은 짧은 Retry-After를 줘도 시도할수록 간격이 늘고, 그 값보다 짧게 기다리지 않는다", () => {
    const busy = new ServerRejectedError(503, "", 2000);

    expect(getRetryDelay(busy, 6, 1)).toBe(MAX_BACKOFF_MS);
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
      expect(getRetryDelay(busy, attempt, 0)).toBe(2000);
    }
  });

  it("Retry-After 값이 BASE_BACKOFF_MS보다 작으면 BASE_BACKOFF_MS로 보정한다", () => {
    const errorWithSmallHeader = new ServerRejectedError(503, "과부하", 0);
    expect(getRetryDelay(errorWithSmallHeader, 0, 1)).toBe(BASE_BACKOFF_MS);
  });

  it("Retry-After 값이 MAX_BACKOFF_MS보다 크면 MAX_BACKOFF_MS로 보정한다", () => {
    const errorWithLargeHeader = new ServerRejectedError(
      503,
      "과부하",
      120_000,
    );
    expect(getRetryDelay(errorWithLargeHeader, 0, 1)).toBe(MAX_BACKOFF_MS);
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

  it("키별로 attempt를 독립적으로 추적하고 특정 키만 초기화할 수 있다", () => {
    const tracker = new BackoffTracker();
    tracker.__setRandomForTests(() => 1);

    expect(tracker.getDelay("doc-a", new OfflineError())).toBe(2000);
    expect(tracker.getDelay("doc-a", new OfflineError())).toBe(4000);
    expect(tracker.getDelay("doc-b", new OfflineError())).toBe(2000);

    expect(tracker.getAttempt("doc-a")).toBe(2);
    expect(tracker.getAttempt("doc-b")).toBe(1);

    tracker.reset("doc-a");
    expect(tracker.getAttempt("doc-a")).toBe(0);
    expect(tracker.getAttempt("doc-b")).toBe(1);

    tracker.reset();
    expect(tracker.getAttempt("doc-b")).toBe(0);
  });

  it("OfflineError는 serverAttempt를 증가시키지 않고 ServerRejectedError만 증가시킨다", () => {
    const tracker = new BackoffTracker();
    tracker.__setRandomForTests(() => 1);

    tracker.getDelay("doc-a", new OfflineError());
    expect(tracker.getAttempt("doc-a")).toBe(1);
    expect(tracker.getServerAttempt("doc-a")).toBe(0);

    tracker.getDelay("doc-a", new ServerRejectedError(503, "과부하"));
    expect(tracker.getAttempt("doc-a")).toBe(2);
    expect(tracker.getServerAttempt("doc-a")).toBe(1);

    tracker.reset("doc-a");
    expect(tracker.getServerAttempt("doc-a")).toBe(0);
  });

  it("세션 만료(401)도 서버 재시도 횟수로 센다", () => {
    const tracker = new BackoffTracker();
    tracker.__setRandomForTests(() => 1);

    expect(tracker.getDelay("doc-a", new SessionExpiredError())).toBe(
      BASE_BACKOFF_MS,
    );
    tracker.getDelay("doc-a", new SessionExpiredError());

    expect(tracker.getAttempt("doc-a")).toBe(2);
    expect(tracker.getServerAttempt("doc-a")).toBe(2);
  });

  it("서버가 거절하지 않은 실패도 서버 재시도 횟수에 넣을 수 있다", () => {
    const tracker = new BackoffTracker();
    tracker.__setRandomForTests(() => 1);

    tracker.getDelay(new TimeoutError());
    tracker.countServerAttempt();

    expect(tracker.getAttempt()).toBe(1);
    expect(tracker.getServerAttempt()).toBe(1);

    tracker.reset();
    expect(tracker.getServerAttempt()).toBe(0);
  });

  it("MAX_RETRY_ATTEMPTS 상수는 10이다", () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(10);
  });
});
