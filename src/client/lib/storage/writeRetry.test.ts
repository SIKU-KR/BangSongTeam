import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BASE_BACKOFF_MS } from "../sync/backoff";
import {
  __resetPersistenceStatusForTests,
  getPersistenceError,
  reportPersistenceError,
} from "./persistenceStatus";
import { createWriteRetry, type WriteOp } from "./writeRetry";

const FIRST_DELAY_MS = BASE_BACKOFF_MS / 2;

const quotaError = (): DOMException =>
  new DOMException("가득 참", "QuotaExceededError");

describe("createWriteRetry", () => {
  let retry: ReturnType<
    typeof vi.fn<(failed: ReadonlyMap<string, WriteOp>) => void>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    __resetPersistenceStatusForTests();
    retry = vi.fn<(failed: ReadonlyMap<string, WriteOp>) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __resetPersistenceStatusForTests();
  });

  it("실패한 쓰기를 알리고, 백오프 뒤에 실패한 항목과 그 쓰기를 넘겨 다시 시도한다", () => {
    const tracker = createWriteRetry("presentation", retry);

    tracker.failed("A", "save", quotaError());

    expect(getPersistenceError("presentation")?.kind).toBe("quota");
    expect(tracker.has("A")).toBe(true);
    vi.advanceTimersByTime(FIRST_DELAY_MS - 1);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledExactlyOnceWith(new Map([["A", "save"]]));
  });

  it("예약한 다시 시도를 백오프를 기다리지 않고 지금 하고, 이미 도는 다시 시도는 겹쳐 하지 않는다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.retryNow();
    expect(retry).not.toHaveBeenCalled();

    tracker.failed("A", "save", quotaError());
    tracker.retryNow();

    expect(retry).toHaveBeenCalledExactlyOnceWith(new Map([["A", "save"]]));
    expect(tracker.has("A")).toBe(true);

    tracker.retryNow();
    vi.advanceTimersByTime(60_000);

    expect(retry).toHaveBeenCalledOnce();
  });

  it("실패한 적 없는 항목이 저장돼도 경고를 남긴다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.failed("A", "save", quotaError());

    tracker.succeeded("B");

    expect(getPersistenceError("presentation")?.kind).toBe("quota");
    vi.advanceTimersByTime(FIRST_DELAY_MS);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("실패한 항목이 모두 저장되면 경고를 지우고 다시 시도하지 않는다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.failed("A", "save", quotaError());
    tracker.failed("B", "delete", quotaError());

    tracker.succeeded("A");

    expect(getPersistenceError("presentation")?.kind).toBe("quota");

    tracker.succeeded("B");

    expect(getPersistenceError("presentation")).toBeNull();
    expect(tracker.has("A")).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(retry).not.toHaveBeenCalled();
  });

  it("다른 저장소의 경고는 지우지 않는다", () => {
    const tracker = createWriteRetry("presentation", retry);
    reportPersistenceError(new Error("disk"), "deck");
    tracker.failed("A", "save", quotaError());

    tracker.succeeded("A");

    expect(getPersistenceError()?.kind).toBe("unknown");
    expect(getPersistenceError("deck")?.kind).toBe("unknown");
  });

  it("마지막 실패의 쓰기로 다시 시도하고, 기다리는 동안 실패한 항목도 같은 시도에 넘긴다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.failed("A", "save", quotaError());
    tracker.failed("B", "save", quotaError());
    tracker.failed("A", "delete", quotaError());

    vi.advanceTimersByTime(FIRST_DELAY_MS);

    expect(retry).toHaveBeenCalledExactlyOnceWith(
      new Map([
        ["A", "delete"],
        ["B", "save"],
      ]),
    );
  });

  it("다시 시도해도 실패하면 더 오래 기다린다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.failed("A", "save", quotaError());
    vi.advanceTimersByTime(FIRST_DELAY_MS);
    expect(retry).toHaveBeenCalledTimes(1);

    tracker.failed("A", "save", quotaError());

    vi.advanceTimersByTime(FIRST_DELAY_MS);
    expect(retry).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FIRST_DELAY_MS);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("모두 저장된 뒤 다시 실패하면 처음 대기부터 센다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.failed("A", "save", quotaError());
    vi.advanceTimersByTime(FIRST_DELAY_MS);
    tracker.succeeded("A");

    tracker.failed("A", "save", quotaError());

    vi.advanceTimersByTime(FIRST_DELAY_MS);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("쓰기를 정해 성공을 알리면 그 쓰기로 실패한 항목만 지운다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.failed("A", "delete", quotaError());

    tracker.succeeded("A", "save");

    expect(tracker.has("A")).toBe(true);
    expect(getPersistenceError("presentation")?.kind).toBe("quota");

    tracker.succeeded("A", "delete");

    expect(tracker.has("A")).toBe(false);
    expect(getPersistenceError("presentation")).toBeNull();
  });

  it("reset은 실패한 항목과 타이머와 경고를 모두 지운다", () => {
    const tracker = createWriteRetry("presentation", retry);
    tracker.failed("A", "save", quotaError());

    tracker.reset();

    expect(tracker.has("A")).toBe(false);
    expect(getPersistenceError("presentation")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(retry).not.toHaveBeenCalled();

    tracker.failed("A", "save", quotaError());
    vi.advanceTimersByTime(FIRST_DELAY_MS);
    expect(retry).toHaveBeenCalledOnce();
  });
});
