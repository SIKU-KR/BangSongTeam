import { describe, it, expect, vi, afterEach } from "vitest";
import {
  canMixColors,
  canStoreMediaOffline,
  getMissingCapabilities,
  getMissingPresentationCapabilities,
} from "./capabilities";

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

function stubFullscreenEnabled(isEnabled: boolean): void {
  Object.defineProperty(document, "fullscreenEnabled", {
    value: isEnabled,
    configurable: true,
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

function stubWakeLock(isAvailable: boolean): void {
  if (isAvailable) {
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn() },
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(navigator, "wakeLock");
  }
}

describe("browser capabilities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stubFullscreen(false);
    Reflect.deleteProperty(document, "fullscreenEnabled");
    stubServiceWorker(false);
    stubWakeLock(false);
  });

  it("전체화면·H.264·화면 꺼짐 방지·오프라인이 모두 되면 빠진 기능이 없다", () => {
    stubFullscreen(true);
    stubCanPlayType("probably");
    stubServiceWorker(true);
    stubWakeLock(true);

    expect(getMissingCapabilities()).toEqual([]);
    expect(getMissingPresentationCapabilities()).toEqual([]);
  });

  it("H.264를 재생하지 못하면 송출 전에 확인이 필요하다", () => {
    stubFullscreen(true);
    stubCanPlayType("");
    stubServiceWorker(true);
    stubWakeLock(true);

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual(["h264"]);
    expect(getMissingPresentationCapabilities().map(({ id }) => id)).toEqual([
      "h264",
    ]);
  });

  it("전체화면 API가 있어도 막혀 있으면(fullscreenEnabled가 false) 전체화면을 쓸 수 없는 것으로 본다", () => {
    stubFullscreen(true);
    stubFullscreenEnabled(false);
    stubCanPlayType("probably");
    stubServiceWorker(true);
    stubWakeLock(true);

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual([
      "fullscreen",
    ]);
    expect(getMissingPresentationCapabilities().map(({ id }) => id)).toEqual([
      "fullscreen",
    ]);
  });

  it("화면 꺼짐 방지(Screen Wake Lock)만 없으면 배너에는 알리지만 송출 전에 묻지 않는다", () => {
    stubFullscreen(true);
    stubFullscreenEnabled(true);
    stubCanPlayType("probably");
    stubServiceWorker(true);
    stubWakeLock(false);

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual(["wakeLock"]);
    expect(getMissingPresentationCapabilities()).toEqual([]);
  });

  it("오프라인 기능만 없으면 배너에는 알리지만 송출 확인은 하지 않는다", () => {
    stubFullscreen(true);
    stubCanPlayType("maybe");
    stubServiceWorker(false);
    stubWakeLock(true);

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual(["offline"]);
    expect(getMissingPresentationCapabilities()).toEqual([]);
  });

  it("송출 전에 묻는 기능은 전체화면과 H.264뿐이라 화면 꺼짐 방지·오프라인은 이름에 들지 않는다", () => {
    stubFullscreen(false);
    stubCanPlayType("");
    stubServiceWorker(false);
    stubWakeLock(false);

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual([
      "fullscreen",
      "h264",
      "wakeLock",
      "offline",
    ]);
    expect(getMissingPresentationCapabilities().map(({ id }) => id)).toEqual([
      "fullscreen",
      "h264",
    ]);
  });

  it("서비스 워커 접근을 거절하는 문서에서는 배너와 송출 준비가 똑같이 오프라인 송출을 못 한다고 본다", () => {
    stubFullscreen(true);
    stubCanPlayType("probably");
    stubWakeLock(true);
    Object.defineProperty(navigator, "serviceWorker", {
      get() {
        throw new DOMException("sandboxed", "SecurityError");
      },
      configurable: true,
    });

    expect(getMissingCapabilities().map(({ id }) => id)).toEqual(["offline"]);
    expect(canStoreMediaOffline()).toBe(false);
  });

  it("서비스 워커와 Cache Storage가 있으면 배경을 받아 두었다가 인터넷 없이 재생할 수 있다", () => {
    stubServiceWorker(true);

    expect(canStoreMediaOffline()).toBe(true);
  });
});

describe("canMixColors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("CSS color-mix()를 Tailwind와 같은 조건으로 확인한다", () => {
    const supports = vi.spyOn(CSS, "supports").mockReturnValue(false);

    expect(canMixColors()).toBe(false);
    expect(supports).toHaveBeenCalledWith(
      "color",
      "color-mix(in lab, red, red)",
    );
  });

  it("color-mix()를 지원하면 색을 섞을 수 있다", () => {
    vi.spyOn(CSS, "supports").mockReturnValue(true);

    expect(canMixColors()).toBe(true);
  });

  it.each([
    ["CSS 객체가 없으면", undefined],
    [
      "확인이 던지면",
      {
        supports: () => {
          throw new Error("boom");
        },
      },
    ],
  ])("%s 확인할 수 없으니 안내하지 않도록 섞을 수 있다고 본다", (_, css) => {
    vi.stubGlobal("CSS", css);

    expect(canMixColors()).toBe(true);
  });
});
