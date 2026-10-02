import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useScreenWakeLock } from "./useScreenWakeLock";

interface FakeSentinel {
  released: boolean;
  release: ReturnType<typeof vi.fn>;
}

function makeSentinel(): FakeSentinel {
  const sentinel: FakeSentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
  };
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

  it("거부되면 조용히 넘어간다", async () => {
    request.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    const { unmount } = renderHook(() => useScreenWakeLock());

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(() => unmount()).not.toThrow();
  });
});
