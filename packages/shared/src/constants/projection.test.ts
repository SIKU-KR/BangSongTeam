import { describe, it, expect } from "vitest";
import { MEDIA_CACHE_NAME, MEDIA_URL_PREFIX } from "./projection";
import { getBackgroundMediaUrl, INITIAL_BACKGROUNDS } from "./backgrounds";

describe("projection constants", () => {
  it("Workbox 런타임 캐시와 백그라운드 캐시가 같은 캐시 이름을 쓴다", () => {
    // vite.config.ts의 runtimeCaching.cacheName과 반드시 동일해야 한다.
    expect(MEDIA_CACHE_NAME).toBe("worship-videos-cache");
  });

  it("미디어 URL 접두사가 실제 생성되는 URL과 일치한다", () => {
    const url = getBackgroundMediaUrl(INITIAL_BACKGROUNDS[0].id);
    expect(url?.startsWith(MEDIA_URL_PREFIX)).toBe(true);
  });
});
