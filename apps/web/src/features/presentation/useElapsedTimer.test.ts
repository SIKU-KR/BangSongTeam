import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElapsedTimer, formatElapsed } from "./useElapsedTimer";

describe("formatElapsed", () => {
  it("1시간 미만은 mm:ss로 보여 준다", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65)).toBe("01:05");
    expect(formatElapsed(599)).toBe("09:59");
  });

  it("1시간을 넘기면 h:mm:ss로 보여 준다", () => {
    expect(formatElapsed(3661)).toBe("1:01:01");
  });

  it("음수는 0으로 다룬다", () => {
    expect(formatElapsed(-5)).toBe("00:00");
  });
});

describe("useElapsedTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("기본으로 곧바로 흐른다", () => {
    const { result } = renderHook(() => useElapsedTimer());

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.elapsedSeconds).toBe(3);
    expect(result.current.elapsed).toBe("00:03");
  });

  it("autoStart를 끄면 멈춰 있다", () => {
    const { result } = renderHook(() => useElapsedTimer({ autoStart: false }));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.elapsedSeconds).toBe(0);
    expect(result.current.isRunning).toBe(false);
  });

  it("멈추고 다시 시작할 수 있다", () => {
    const { result } = renderHook(() => useElapsedTimer());

    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.pause();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.elapsedSeconds).toBe(2);

    act(() => {
      result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsedSeconds).toBe(3);
  });

  it("리셋하면 0으로 돌아간다", () => {
    const { result } = renderHook(() => useElapsedTimer());

    act(() => {
      vi.advanceTimersByTime(4000);
      result.current.reset();
    });

    expect(result.current.elapsedSeconds).toBe(0);
  });

  it("현재 시각을 HH:MM으로 보여 준다", () => {
    const { result } = renderHook(() => useElapsedTimer());

    expect(result.current.clock).toMatch(/^\d{2}:\d{2}$/);
  });

  it("언마운트하면 타이머를 정리한다", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useElapsedTimer());

    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});
