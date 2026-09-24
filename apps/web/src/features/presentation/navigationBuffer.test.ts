import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNavigationBuffer } from "./useNavigationBuffer";

describe("useNavigationBuffer Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: '3' + Enter -> triggers jump to slide number 3", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("3");
    });
    expect(result.current.buffer).toBe("3");

    act(() => {
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(3);
    expect(result.current.buffer).toBe("");
  });

  it("Test 2: multi-digit '12' + Enter -> triggers jump to slide number 12", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("1");
      result.current.handleKey("2");
    });
    expect(result.current.buffer).toBe("12");

    act(() => {
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(12);
    expect(result.current.buffer).toBe("");
  });

  it("Test 3: the last slide number (= totalSlides) is valid", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("2");
      result.current.handleKey("0");
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledWith(20);
  });

  it("Test 3b: leading zero is read as the same number ('07' -> 7)", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("0");
      result.current.handleKey("7");
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledWith(7);
  });

  it("Test 4: Backspace removes the last character from buffer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 200,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("1");
      result.current.handleKey("2");
      result.current.handleKey("4");
    });
    expect(result.current.buffer).toBe("124");

    act(() => {
      result.current.handleKey("Backspace");
    });
    expect(result.current.buffer).toBe("12");

    act(() => {
      result.current.handleKey("Backspace");
    });
    expect(result.current.buffer).toBe("1");

    act(() => {
      result.current.handleKey("Backspace");
    });
    expect(result.current.buffer).toBe("");

    // Additional Backspace when empty doesn't error
    act(() => {
      result.current.handleKey("Backspace");
    });
    expect(result.current.buffer).toBe("");
  });

  it("Test 5: Automatically clears buffer after 3000ms of inactivity", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
        timeoutMs: 3000,
      }),
    );

    act(() => {
      result.current.handleKey("2");
    });
    expect(result.current.buffer).toBe("2");

    // Advance 2999ms -> buffer should still be "2"
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current.buffer).toBe("2");

    // Advance remaining 1ms -> total 3000ms -> buffer cleared
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.buffer).toBe("");
  });

  it("Test 5b: Any new keypress resets the 3000ms timer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
        timeoutMs: 3000,
      }),
    );

    act(() => {
      result.current.handleKey("1");
    });

    // Advance 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.buffer).toBe("1");

    // New key resets timer
    act(() => {
      result.current.handleKey("2");
    });
    expect(result.current.buffer).toBe("12");

    // Advance 2000ms (total 4000ms from start, but only 2000ms since last key)
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.buffer).toBe("12");

    // Advance another 1000ms -> clears
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.buffer).toBe("");
  });

  it("Test 6: Invalid inputs do not trigger onJump and clear buffer", () => {
    const onJump = vi.fn();
    const onInvalidJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 5,
        onJump,
        onInvalidJump,
      }),
    );

    // 1. Beyond the last slide: 6 when only 5 slides exist
    act(() => {
      result.current.handleKey("6");
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
    expect(onInvalidJump).toHaveBeenCalledWith("6");
    expect(result.current.buffer).toBe("");

    // 2. Slide number 0 (1-based numbering required)
    act(() => {
      result.current.handleKey("0");
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
    expect(onInvalidJump).toHaveBeenCalledWith("0");
    expect(result.current.buffer).toBe("");

    // 3. Empty buffer + Enter -> should do nothing
    act(() => {
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
    expect(onInvalidJump).toHaveBeenCalledTimes(2);
  });

  it("Test 6b: without totalSlides only the lower bound is checked", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() => useNavigationBuffer({ onJump }));

    act(() => {
      result.current.handleKey("9");
      result.current.handleKey("9");
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledWith(99);
  });

  it("Test 7: Ignores non-numeric characters, including the old '.' separator", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("a");
      result.current.handleKey(" ");
      result.current.handleKey("!");
      result.current.handleKey(".");
    });
    expect(result.current.buffer).toBe("");

    act(() => {
      result.current.handleKey("1");
      result.current.handleKey(".");
      result.current.handleKey("x");
      result.current.handleKey("2");
    });
    expect(result.current.buffer).toBe("12");

    act(() => {
      result.current.handleKey("Enter");
    });
    expect(onJump).toHaveBeenCalledWith(12);
  });

  it("Test 8: clearBuffer manually resets buffer and timer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        totalSlides: 20,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("1");
      result.current.handleKey("2");
    });
    expect(result.current.buffer).toBe("12");

    act(() => {
      result.current.clearBuffer();
    });
    expect(result.current.buffer).toBe("");
  });
});
