import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { PRESENTATION_SHORTCUTS } from "#shared";
import { useNavigationBuffer } from "./useNavigationBuffer";

const TIMEOUT_MS = PRESENTATION_SHORTCUTS.BUFFER_CLEAR_TIMEOUT_MS;

function typeKeys(
  handleKey: (key: string) => void,
  keys: readonly string[],
): void {
  act(() => {
    for (const key of keys) handleKey(key);
  });
}

describe("useNavigationBuffer Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Test 1: '3' + Enter -> triggers jump to slide number 3", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 20, onJump }),
    );

    typeKeys(result.current.handleKey, ["3"]);
    expect(onJump).not.toHaveBeenCalled();

    typeKeys(result.current.handleKey, ["Enter"]);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(3);

    typeKeys(result.current.handleKey, ["Enter"]);
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("Test 2: multi-digit '12' + Enter -> triggers jump to slide number 12", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 20, onJump }),
    );

    typeKeys(result.current.handleKey, ["1", "2", "Enter"]);

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(12);
  });

  it("Test 3: the last slide number (= totalSlides) is valid", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 20, onJump }),
    );

    typeKeys(result.current.handleKey, ["2", "0", "Enter"]);

    expect(onJump).toHaveBeenCalledWith(20);
  });

  it("Test 3b: leading zero is read as the same number ('07' -> 7)", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 20, onJump }),
    );

    typeKeys(result.current.handleKey, ["0", "7", "Enter"]);

    expect(onJump).toHaveBeenCalledWith(7);
  });

  it("Test 4: Backspace removes the last character from buffer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 200, onJump }),
    );

    typeKeys(result.current.handleKey, ["1", "2", "4", "Backspace", "Enter"]);
    expect(onJump).toHaveBeenLastCalledWith(12);

    typeKeys(result.current.handleKey, ["1", "2", "Backspace", "Enter"]);
    expect(onJump).toHaveBeenLastCalledWith(1);

    typeKeys(result.current.handleKey, [
      "1",
      "Backspace",
      "Backspace",
      "Backspace",
      "Enter",
    ]);
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  it("Test 5: Automatically clears buffer after the inactivity timeout", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 20, onJump }),
    );

    typeKeys(result.current.handleKey, ["2"]);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS - 1);
    });
    typeKeys(result.current.handleKey, ["Enter"]);
    expect(onJump).toHaveBeenCalledWith(2);

    onJump.mockClear();
    typeKeys(result.current.handleKey, ["2"]);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS);
    });
    typeKeys(result.current.handleKey, ["Enter"]);
    expect(onJump).not.toHaveBeenCalled();
  });

  it("Test 5b: Any new keypress resets the timer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 20, onJump }),
    );

    typeKeys(result.current.handleKey, ["1"]);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS - 1000);
    });
    typeKeys(result.current.handleKey, ["2"]);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS - 1000);
    });
    typeKeys(result.current.handleKey, ["Enter"]);
    expect(onJump).toHaveBeenCalledWith(12);

    onJump.mockClear();
    typeKeys(result.current.handleKey, ["1", "2"]);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT_MS);
    });
    typeKeys(result.current.handleKey, ["Enter"]);
    expect(onJump).not.toHaveBeenCalled();
  });

  it("Test 6: Invalid inputs do not trigger onJump and clear buffer", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 5, onJump }),
    );

    typeKeys(result.current.handleKey, ["6", "Enter"]);
    expect(onJump).not.toHaveBeenCalled();

    typeKeys(result.current.handleKey, ["0", "Enter"]);
    expect(onJump).not.toHaveBeenCalled();

    typeKeys(result.current.handleKey, ["Enter"]);
    expect(onJump).not.toHaveBeenCalled();

    typeKeys(result.current.handleKey, ["3", "Enter"]);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(3);
  });

  it("Test 6b: without totalSlides only the lower bound is checked", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() => useNavigationBuffer({ onJump }));

    typeKeys(result.current.handleKey, ["9", "9", "Enter"]);

    expect(onJump).toHaveBeenCalledWith(99);
  });

  it("Test 7: Ignores non-numeric characters, including the old '.' separator", () => {
    const onJump = vi.fn();
    const { result } = renderHook(() =>
      useNavigationBuffer({ totalSlides: 20, onJump }),
    );

    typeKeys(result.current.handleKey, ["a", " ", "!", ".", "Enter"]);
    expect(onJump).not.toHaveBeenCalled();

    typeKeys(result.current.handleKey, ["1", ".", "x", "2", "Enter"]);
    expect(onJump).toHaveBeenCalledWith(12);
  });
});
