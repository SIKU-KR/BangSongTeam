import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openAudienceWindow, buildAudienceUrl } from "./audienceWindow";

const PRESENTATION_ID = "10000000-0000-4000-8000-000000000001";

const openSpy = vi.fn();
const originalOpen = window.open;

beforeEach(() => {
  openSpy.mockReset().mockReturnValue({} as Window);
  window.open = openSpy as unknown as typeof window.open;
});

afterEach(() => {
  window.open = originalOpen;
  // @ts-expect-error 테스트에서 주입한 API를 되돌린다
  delete window.getScreenDetails;
  vi.restoreAllMocks();
});

function withScreens(details: unknown): void {
  Object.defineProperty(window, "getScreenDetails", {
    value: async () => details,
    configurable: true,
    writable: true,
  });
}

describe("buildAudienceUrl", () => {
  it("전체화면 경로에 청중 모드 플래그를 붙인다", () => {
    expect(buildAudienceUrl(PRESENTATION_ID)).toBe(
      `/present/${PRESENTATION_ID}/fullscreen?audience=1`,
    );
  });
});

describe("openAudienceWindow", () => {
  it("보조 모니터가 있으면 그 좌표로 연다", async () => {
    const current = { availLeft: 0, availTop: 0 };
    const secondary = {
      availLeft: 1920,
      availTop: 0,
      availWidth: 1280,
      availHeight: 720,
    };
    withScreens({ screens: [current, secondary], currentScreen: current });

    const result = await openAudienceWindow(PRESENTATION_ID);

    expect(result.status).toBe("secondary");
    expect(openSpy).toHaveBeenCalledWith(
      buildAudienceUrl(PRESENTATION_ID),
      "WorshipAudienceWindow",
      "left=1920,top=0,width=1280,height=720",
    );
  });

  it("모니터가 하나면 일반 팝업으로 열고 안내를 돌려준다", async () => {
    const current = { availLeft: 0, availTop: 0 };
    withScreens({ screens: [current], currentScreen: current });

    const result = await openAudienceWindow(PRESENTATION_ID);

    expect(result.status).toBe("fallback");
    expect(result.message).toContain("프로젝터 화면으로 옮긴 뒤");
    expect(openSpy).toHaveBeenCalledWith(
      expect.any(String),
      "WorshipAudienceWindow",
      "width=1280,height=720",
    );
  });

  it("권한을 거부해도 막다른 길이 되지 않는다", async () => {
    Object.defineProperty(window, "getScreenDetails", {
      value: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
      configurable: true,
      writable: true,
    });

    const result = await openAudienceWindow(PRESENTATION_ID);

    expect(result.status).toBe("fallback");
    expect(result.window).not.toBeNull();
  });

  it("Window Management API가 없는 브라우저도 창은 연다", async () => {
    const result = await openAudienceWindow(PRESENTATION_ID);

    expect(result.status).toBe("fallback");
    expect(openSpy).toHaveBeenCalled();
  });

  it("팝업이 막히면 그 사실을 구분해 알린다", async () => {
    openSpy.mockReturnValue(null);

    const result = await openAudienceWindow(PRESENTATION_ID);

    expect(result.status).toBe("blocked");
    expect(result.window).toBeNull();
    expect(result.message).toContain("팝업");
  });

  it("같은 창 이름을 써서 두 번 눌러도 창이 하나만 생긴다", async () => {
    await openAudienceWindow(PRESENTATION_ID);
    await openAudienceWindow(PRESENTATION_ID);

    const names = openSpy.mock.calls.map((call) => call[1]);
    expect(new Set(names)).toEqual(new Set(["WorshipAudienceWindow"]));
  });
});
