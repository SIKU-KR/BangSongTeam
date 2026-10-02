import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePresentationShortcuts } from "./usePresentationShortcuts";
import { useNavigationBuffer } from "./useNavigationBuffer";

function pressKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

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

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }),
    );
    expect(onToggleBlackout).toHaveBeenCalledTimes(1);

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

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "h", code: "KeyH", bubbles: true }),
    );
    expect(onToggleLyrics).toHaveBeenCalledTimes(1);

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

  it("should delegate numeric keys, Enter, and Backspace to the navigation buffer", () => {
    const handleKey = vi.fn();

    renderHook(() =>
      usePresentationShortcuts({
        navigationBuffer: { handleKey },
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
        navigationBuffer: { handleKey },
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

  it("ArrowDown은 다음, ArrowUp은 이전으로 넘긴다", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderHook(() => usePresentationShortcuts({ onNext, onPrev }));

    pressKey({ key: "ArrowDown", code: "ArrowDown" });
    pressKey({ key: "ArrowUp", code: "ArrowUp" });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("마침표(.)로 블랙아웃을 켜고 끈다", () => {
    const onToggleBlackout = vi.fn();
    renderHook(() => usePresentationShortcuts({ onToggleBlackout }));

    pressKey({ key: ".", code: "Period" });

    expect(onToggleBlackout).toHaveBeenCalledTimes(1);
  });

  it.each([
    { key: "ㅠ", code: "KeyB", label: "한글 입력 상태의 B" },
    { key: "B", code: "KeyB", label: "Caps Lock이 켜진 B" },
  ])("$label도 블랙아웃을 켜고 끈다", ({ key, code }) => {
    const onToggleBlackout = vi.fn();
    renderHook(() => usePresentationShortcuts({ onToggleBlackout }));

    pressKey({ key, code });

    expect(onToggleBlackout).toHaveBeenCalledTimes(1);
  });

  it("한글 입력 상태의 H도 가사를 숨기고 보인다", () => {
    const onToggleLyrics = vi.fn();
    renderHook(() => usePresentationShortcuts({ onToggleLyrics }));

    pressKey({ key: "ㅗ", code: "KeyH" });

    expect(onToggleLyrics).toHaveBeenCalledTimes(1);
  });

  it.each([
    { key: "F5", code: "F5" },
    { key: "F5", code: "F5", repeat: true },
    { key: "F5", code: "F5", shiftKey: true },
    { key: "r", code: "KeyR", ctrlKey: true },
    { key: "ㄱ", code: "KeyR", metaKey: true },
    { key: "ArrowLeft", code: "ArrowLeft", altKey: true },
    { key: "ArrowRight", code: "ArrowRight", altKey: true },
    { key: "ArrowLeft", code: "ArrowLeft", metaKey: true },
    { key: "ArrowRight", code: "ArrowRight", metaKey: true },
    { key: "[", code: "BracketLeft", metaKey: true },
    { key: "]", code: "BracketRight", metaKey: true },
    { key: "BrowserBack", code: "BrowserBack" },
    { key: "BrowserForward", code: "BrowserForward" },
    { key: "BrowserRefresh", code: "BrowserRefresh" },
  ])("새로고침·뒤로 가기 키($key)의 기본 동작을 막는다", (init) => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    renderHook(() => usePresentationShortcuts({ onPrev, onNext }));

    const event = pressKey(init);

    expect(event.defaultPrevented).toBe(true);
    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it.each([3, 4])(
    "마우스 옆 버튼(%i)의 뒤로·앞으로 가기를 막는다",
    (button) => {
      renderHook(() => usePresentationShortcuts({}));

      const mouseup = new MouseEvent("mouseup", { button, cancelable: true });
      const auxclick = new MouseEvent("auxclick", { button, cancelable: true });
      window.dispatchEvent(mouseup);
      window.dispatchEvent(auxclick);

      expect(mouseup.defaultPrevented).toBe(true);
      expect(auxclick.defaultPrevented).toBe(true);
    },
  );

  it("마우스 가운데 버튼은 막지 않는다", () => {
    renderHook(() => usePresentationShortcuts({}));

    const auxclick = new MouseEvent("auxclick", {
      button: 1,
      cancelable: true,
    });
    window.dispatchEvent(auxclick);

    expect(auxclick.defaultPrevented).toBe(false);
  });

  it("입력 중인 번호가 없으면 Enter로 넘기지 않는다", () => {
    const onNext = vi.fn();
    const onJump = vi.fn();
    renderHook(() => {
      const nav = useNavigationBuffer({ totalSlides: 15, onJump });
      usePresentationShortcuts({ onNext, navigationBuffer: nav });
    });

    act(() => {
      pressKey({ key: "Enter", code: "Enter" });
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(onJump).not.toHaveBeenCalled();
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
