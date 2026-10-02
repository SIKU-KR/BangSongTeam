import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFullscreenSession } from "./useFullscreenSession";

function setFullscreenElement(element: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", {
    value: element,
    configurable: true,
  });
}

function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, code: key }));
}

function touchPointer(type: string): Event {
  return Object.assign(new MouseEvent(type), { pointerType: "touch" });
}

describe("useFullscreenSession", () => {
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  const exitFullscreen = vi.fn().mockResolvedValue(undefined);
  const lock = vi.fn().mockResolvedValue(undefined);
  const unlock = vi.fn();

  beforeEach(() => {
    requestFullscreen.mockClear();
    exitFullscreen.mockClear();
    lock.mockClear();
    unlock.mockClear();
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: requestFullscreen,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "exitFullscreen", {
      value: exitFullscreen,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "keyboard", {
      value: { lock, unlock },
      configurable: true,
    });
    setFullscreenElement(document.createElement("div"));
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "keyboard");
    setFullscreenElement(null);
  });

  it("짧은 Esc를 페이지가 받도록 Esc 키를 잠그고, 끝나면 푼다", () => {
    const { unmount } = renderHook(() =>
      useFullscreenSession({ current: false }),
    );

    expect(lock).toHaveBeenCalledWith(["Escape"]);

    unmount();

    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("전체화면이 풀린 뒤 다음 키 입력에서 다시 요청하고, Esc에서는 요청하지 않는다", () => {
    renderHook(() => useFullscreenSession({ current: false }));
    setFullscreenElement(null);

    pressKey("Escape");
    expect(requestFullscreen).not.toHaveBeenCalled();

    pressKey("PageDown");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("클릭으로도 다시 요청하지만, 버튼 클릭은 버튼에 맡긴다", () => {
    renderHook(() => useFullscreenSession({ current: false }));
    setFullscreenElement(null);
    const button = document.createElement("button");
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(requestFullscreen).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("pointerdown"));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    button.remove();
  });

  it("수정 키나 수정 키 조합에서는 다시 요청하지 않는다", () => {
    renderHook(() => useFullscreenSession({ current: false }));
    setFullscreenElement(null);

    pressKey("Meta");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", code: "Tab", metaKey: true }),
    );
    pressKey("Shift");

    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("버튼에 초점이 있을 때의 키 입력은 버튼에 맡긴다", () => {
    renderHook(() => useFullscreenSession({ current: false }));
    setFullscreenElement(null);
    const button = document.createElement("button");
    document.body.appendChild(button);

    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(requestFullscreen).not.toHaveBeenCalled();
    button.remove();
  });

  it("터치는 손을 뗄 때 다시 요청한다", () => {
    renderHook(() => useFullscreenSession({ current: false }));
    setFullscreenElement(null);

    window.dispatchEvent(touchPointer("pointerdown"));
    expect(requestFullscreen).not.toHaveBeenCalled();

    window.dispatchEvent(touchPointer("pointerup"));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("송출을 끝내는 중에는 다시 요청하지 않는다", () => {
    renderHook(() => useFullscreenSession({ current: true }));
    setFullscreenElement(null);

    pressKey("PageDown");

    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("주소가 그대로인 언마운트에서는 전체화면을 유지하고, 다른 주소로 떠나면 푼다", () => {
    const first = renderHook(() => useFullscreenSession({ current: false }));
    first.unmount();
    expect(exitFullscreen).not.toHaveBeenCalled();

    const second = renderHook(() => useFullscreenSession({ current: false }));
    window.history.pushState(null, "", "/presentations");
    second.unmount();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    window.history.back();
  });
});
