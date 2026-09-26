import { describe, it, expect, vi, afterEach } from "vitest";
import { canPresentReliably, getMissingCapabilities } from "./capabilities";

function stubCanPlayType(result: CanPlayTypeResult): void {
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue(result);
}

function stubFullscreen(isAvailable: boolean): void {
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    value: isAvailable ? vi.fn().mockResolvedValue(undefined) : undefined,
    configurable: true,
    writable: true,
  });
}

function stubServiceWorker(isAvailable: boolean): void {
  if (isAvailable) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: {},
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
}

describe("browser capabilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stubFullscreen(false);
    stubServiceWorker(false);
  });

  it("전체화면·H.264·오프라인이 모두 되면 빠진 기능이 없다", () => {
    stubFullscreen(true);
    stubCanPlayType("probably");
    stubServiceWorker(true);

    expect(getMissingCapabilities()).toEqual([]);
    expect(canPresentReliably()).toBe(true);
  });

  it("H.264를 재생하지 못하면 송출 전에 확인이 필요하다", () => {
    stubFullscreen(true);
    stubCanPlayType("");
    stubServiceWorker(true);

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual(["h264"]);
    expect(canPresentReliably()).toBe(false);
  });

  it("오프라인 기능만 없으면 배너에는 알리지만 송출 확인은 하지 않는다", () => {
    stubFullscreen(true);
    stubCanPlayType("maybe");
    stubServiceWorker(false);

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual(["offline"]);
    expect(canPresentReliably()).toBe(true);
  });
});
