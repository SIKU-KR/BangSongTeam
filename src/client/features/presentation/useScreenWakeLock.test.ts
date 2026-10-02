import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useScreenWakeLock } from "./useScreenWakeLock";

interface FakeSentinel extends EventTarget {
  released: boolean;
  release: ReturnType<typeof vi.fn>;
}

function makeSentinel(): FakeSentinel {
  const sentinel = Object.assign(new EventTarget(), {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
      sentinel.dispatchEvent(new Event("release"));
    }),
  });
  return sentinel;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useScreenWakeLock", () => {
  let sentinels: FakeSentinel[];
  const request = vi.fn();

  beforeEach(() => {
    sentinels = [];
    request.mockReset();
    request.mockImplementation(async () => {
      const sentinel = makeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    Object.defineProperty(navigator, "wakeLock", {
      value: { request },
      configurable: true,
    });
    setVisibility("visible");
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("마운트하면 화면 잠금 방지를 잡고, 언마운트하면 놓는다", async () => {
    const { unmount } = renderHook(() => useScreenWakeLock());

    await waitFor(() => expect(sentinels).toHaveLength(1));
    expect(request).toHaveBeenCalledWith("screen");

    unmount();

    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("탭이 가려졌다 다시 보이면 새로 잡는다", async () => {
    renderHook(() => useScreenWakeLock());
    await waitFor(() => expect(sentinels).toHaveLength(1));

    sentinels[0].released = true;
    setVisibility("hidden");
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("visible");

    await waitFor(() => expect(sentinels).toHaveLength(2));
  });

  it("시스템이 잠금을 풀면 화면이 보이는 동안 새로 잡는다", async () => {
    renderHook(() => useScreenWakeLock());
    await waitFor(() => expect(sentinels).toHaveLength(1));

    sentinels[0].released = true;
    sentinels[0].dispatchEvent(new Event("release"));

    await waitFor(() => expect(sentinels).toHaveLength(2));
  });

  it("첫 요청이 거부되면 다음 키 입력·클릭에서 다시 요청한다", async () => {
    request.mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );
    renderHook(() => useScreenWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    await waitFor(() => expect(sentinels).toHaveLength(1));

    sentinels[0].released = true;
    window.dispatchEvent(new MouseEvent("pointerdown"));
    await waitFor(() => expect(sentinels).toHaveLength(2));
  });

  it("거부되면 조용히 넘어간다", async () => {
    request.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    const { unmount } = renderHook(() => useScreenWakeLock());

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(() => unmount()).not.toThrow();
  });
});
