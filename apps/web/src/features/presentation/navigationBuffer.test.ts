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

  it("Test 1: '3' + Enter -> triggers jump to current song's 3rd slide (slideIndex: 2)", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: (songIndex) => (songIndex === 0 ? 5 : 4),
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
    expect(onJump).toHaveBeenCalledWith(0, 2);
    expect(result.current.buffer).toBe("");
  });

  it("Test 1b: '3' + Enter with different currentSongIndex (e.g. currentSongIndex: 1)", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        currentSongIndex: 1,
        songCount: 3,
        getSlideCount: () => 5,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("3");
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(1, 2);
  });

  it("Test 2: '2.' + Enter -> triggers jump to 2nd song's 1st slide (songIndex: 1, slideIndex: 0)", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: () => 5,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("2");
      result.current.handleKey(".");
    });
    expect(result.current.buffer).toBe("2.");

    act(() => {
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(1, 0);
    expect(result.current.buffer).toBe("");
  });

  it("Test 3: '2.4' + Enter -> triggers jump to 2nd song's 4th slide (songIndex: 1, slideIndex: 3)", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: (songIndex) => (songIndex === 1 ? 5 : 3),
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("2");
      result.current.handleKey(".");
      result.current.handleKey("4");
    });
    expect(result.current.buffer).toBe("2.4");

    act(() => {
      result.current.handleKey("Enter");
    });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(1, 3);
    expect(result.current.buffer).toBe("");
  });

  it("Test 4: Backspace removes the last character from buffer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: () => 5,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("2");
      result.current.handleKey(".");
      result.current.handleKey("4");
    });
    expect(result.current.buffer).toBe("2.4");

    act(() => {
      result.current.handleKey("Backspace");
    });
    expect(result.current.buffer).toBe("2.");

    act(() => {
      result.current.handleKey("Backspace");
    });
    expect(result.current.buffer).toBe("2");

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
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: () => 5,
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
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: () => 5,
        onJump,
        timeoutMs: 3000,
      }),
    );

    act(() => {
      result.current.handleKey("2");
    });

    // Advance 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.buffer).toBe("2");

    // New key resets timer
    act(() => {
      result.current.handleKey(".");
    });
    expect(result.current.buffer).toBe("2.");

    // Advance 2000ms (total 4000ms from start, but only 2000ms since last key)
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.buffer).toBe("2.");

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
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: (songIndex) => (songIndex === 0 ? 3 : 2),
        onJump,
        onInvalidJump,
      }),
    );

    // 1. Song index out of bounds: song 5 when only 3 songs exist
    act(() => {
      result.current.handleKey("5");
      result.current.handleKey(".");
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
    expect(onInvalidJump).toHaveBeenCalledWith("5.");
    expect(result.current.buffer).toBe("");

    // 2. Slide index out of bounds: song 1 slide 9 (only 3 slides)
    act(() => {
      result.current.handleKey("9");
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
    expect(onInvalidJump).toHaveBeenCalledWith("9");
    expect(result.current.buffer).toBe("");

    // 3. Slide index 0 (1-based index required)
    act(() => {
      result.current.handleKey("0");
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
    expect(onInvalidJump).toHaveBeenCalledWith("0");
    expect(result.current.buffer).toBe("");

    // 4. Dot only or invalid format
    act(() => {
      result.current.handleKey(".");
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
    expect(result.current.buffer).toBe("");

    // 5. Empty buffer + Enter -> should do nothing
    act(() => {
      result.current.handleKey("Enter");
    });
    expect(onJump).not.toHaveBeenCalled();
  });

  it("Test 7: Ignores non-numeric / non-dot invalid characters", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: () => 5,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("a");
      result.current.handleKey(" ");
      result.current.handleKey("!");
    });
    expect(result.current.buffer).toBe("");

    act(() => {
      result.current.handleKey("1");
      result.current.handleKey("x");
      result.current.handleKey("2");
    });
    expect(result.current.buffer).toBe("12");
  });

  it("Test 8: clearBuffer manually resets buffer and timer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({
        currentSongIndex: 0,
        songCount: 3,
        getSlideCount: () => 5,
        onJump,
      }),
    );

    act(() => {
      result.current.handleKey("1");
      result.current.handleKey(".");
    });
    expect(result.current.buffer).toBe("1.");

    act(() => {
      result.current.clearBuffer();
    });
    expect(result.current.buffer).toBe("");
  });
});
