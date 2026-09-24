import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePresentationShortcuts } from "./usePresentationShortcuts";
import { useNavigationBuffer } from "./useNavigationBuffer";

describe("usePresentationShortcuts Hook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should trigger onNext on ArrowRight, Space, and PageDown", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        onNext,
        onPrev,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        bubbles: true,
      }),
    );
    expect(onNext).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }),
    );
    expect(onNext).toHaveBeenCalledTimes(2);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "PageDown",
        code: "PageDown",
        bubbles: true,
      }),
    );
    expect(onNext).toHaveBeenCalledTimes(3);

    expect(onPrev).not.toHaveBeenCalled();
  });

  it("should trigger onPrev on ArrowLeft and PageUp", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        onNext,
        onPrev,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        code: "ArrowLeft",
        bubbles: true,
      }),
    );
    expect(onPrev).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "PageUp",
        code: "PageUp",
        bubbles: true,
      }),
    );
    expect(onPrev).toHaveBeenCalledTimes(2);

    expect(onNext).not.toHaveBeenCalled();
  });

  it("should trigger onToggleBlackout on 'b' and 'B'", () => {
    const onToggleBlackout = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        onToggleBlackout,
      }),
    );

    // Lowercase 'b'
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }),
    );
    expect(onToggleBlackout).toHaveBeenCalledTimes(1);

    // Uppercase 'B' (with Shift)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "B",
        code: "KeyB",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(onToggleBlackout).toHaveBeenCalledTimes(2);
  });

  it("should trigger onToggleLyrics on 'h' and 'H'", () => {
    const onToggleLyrics = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        onToggleLyrics,
      }),
    );

    // Lowercase 'h'
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "h", code: "KeyH", bubbles: true }),
    );
    expect(onToggleLyrics).toHaveBeenCalledTimes(1);

    // Uppercase 'H' (with Shift)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "H",
        code: "KeyH",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(onToggleLyrics).toHaveBeenCalledTimes(2);
  });

  it("should delegate numeric keys, Enter, and Backspace to handleKey", () => {
    const handleKey = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        handleKey,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true }),
    );
    expect(handleKey).toHaveBeenCalledWith("2");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "4", code: "Digit4", bubbles: true }),
    );
    expect(handleKey).toHaveBeenCalledWith("4");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
      }),
    );
    expect(handleKey).toHaveBeenCalledWith("Enter");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        bubbles: true,
      }),
    );
    expect(handleKey).toHaveBeenCalledWith("Backspace");
  });

  it("should accept navigationBuffer object with handleKey", () => {
    const mockNavigationBuffer = {
      buffer: "",
      handleKey: vi.fn(),
      clearBuffer: vi.fn(),
    };

    renderHook(() =>
      usePresentationShortcuts({
        navigationBuffer: mockNavigationBuffer,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "5", code: "Digit5", bubbles: true }),
    );
    expect(mockNavigationBuffer.handleKey).toHaveBeenCalledWith("5");
  });

  it("should not trigger shortcuts when enabled is false", () => {
    const onNext = vi.fn();
    const handleKey = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        onNext,
        handleKey,
        enabled: false,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true }),
    );

    expect(onNext).not.toHaveBeenCalled();
    expect(handleKey).not.toHaveBeenCalled();
  });

  it("should cleanup event listeners when unmounted", () => {
    const onNext = vi.fn();
    const { unmount } = renderHook(() =>
      usePresentationShortcuts({
        onNext,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        bubbles: true,
      }),
    );
    expect(onNext).toHaveBeenCalledTimes(1);

    unmount();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        bubbles: true,
      }),
    );
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("should ignore shortcuts when typing inside an input or textarea", () => {
    const onNext = vi.fn();
    const handleKey = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        onNext,
        handleKey,
      }),
    );

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        bubbles: true,
      }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "1",
        code: "Digit1",
        bubbles: true,
      }),
    );

    expect(onNext).not.toHaveBeenCalled();
    expect(handleKey).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("integration: should integrate with useNavigationBuffer to jump on numpad/digit sequence", () => {
    const onJump = vi.fn();
    renderHook(() => {
      const nav = useNavigationBuffer({
        totalSlides: 15,
        onJump,
      });
      usePresentationShortcuts({
        navigationBuffer: nav,
      });
      return nav;
    });

    // Press '1', '2', 'Enter' within act -> presentation-wide slide 12
    act(() => {
      for (const [key, code] of [
        ["1", "Digit1"],
        ["2", "Digit2"],
        ["Enter", "Enter"],
      ]) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key, code, bubbles: true }),
        );
      }
    });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(12);
  });
});
