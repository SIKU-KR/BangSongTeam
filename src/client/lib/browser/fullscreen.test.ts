import { describe, it, expect, vi } from "vitest";
import { resolveFullscreenStrategy } from "./fullscreen";

function fakeDocument(
  documentProps: Record<string, unknown>,
  elementProps: Record<string, unknown> = {},
): Document {
  return {
    ...documentProps,
    documentElement: { ...elementProps },
  } as unknown as Document;
}

describe("resolveFullscreenStrategy", () => {
  it("표준 API가 있으면 standard 전략을 고른다", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const doc = fakeDocument(
      { fullscreenElement: null },
      { requestFullscreen },
    );

    const strategy = resolveFullscreenStrategy(doc);

    expect(strategy.kind).toBe("standard");
    expect(strategy.changeEvent).toBe("fullscreenchange");
    await strategy.request(doc.documentElement, { navigationUI: "hide" });
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
  });

  it("접두사 API만 있으면 webkit 전략을 고르고 Promise가 아닌 반환값도 감싼다", async () => {
    const active = {} as Element;
    const webkitRequestFullscreen = vi.fn(() => undefined);
    const webkitExitFullscreen = vi.fn(() => undefined);
    const doc = fakeDocument(
      { webkitFullscreenElement: active, webkitExitFullscreen },
      { webkitRequestFullscreen },
    );

    const strategy = resolveFullscreenStrategy(doc);

    expect(strategy.kind).toBe("webkit");
    expect(strategy.changeEvent).toBe("webkitfullscreenchange");
    expect(strategy.element(doc)).toBe(active);
    await expect(
      strategy.request(doc.documentElement),
    ).resolves.toBeUndefined();
    await expect(strategy.exit(doc)).resolves.toBeUndefined();
    expect(webkitRequestFullscreen).toHaveBeenCalled();
    expect(webkitExitFullscreen).toHaveBeenCalled();
  });

  it("전체화면 API가 없으면 unsupported 전략이 요청을 거절한다", async () => {
    const doc = fakeDocument({});

    const strategy = resolveFullscreenStrategy(doc);

    expect(strategy.kind).toBe("unsupported");
    expect(strategy.changeEvent).toBeNull();
    expect(strategy.element(doc)).toBeNull();
    await expect(strategy.request(doc.documentElement)).rejects.toThrow();
  });

  it("standard 전략은 요소에 requestFullscreen이 없으면 거절한다", async () => {
    const doc = fakeDocument({ fullscreenElement: null });

    await expect(
      resolveFullscreenStrategy(doc).request(doc.documentElement),
    ).rejects.toThrow();
  });
});
