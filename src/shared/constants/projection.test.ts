import { describe, it, expect } from "vitest";
import {
  MEDIA_CACHE_NAME,
  MEDIA_URL_PREFIX,
  POSTER_CACHE_NAME,
  mediaCacheNameFor,
} from "./projection";
import { mediaUrlForKey } from "./backgrounds";

describe("projection constants", () => {
  it("Workbox 런타임 캐시와 백그라운드 캐시가 같은 캐시 이름을 쓴다", () => {
    expect(MEDIA_CACHE_NAME).toBe("worship-videos-cache");
  });

  it("미디어 URL 접두사가 실제 생성되는 URL과 일치한다", () => {
    expect(mediaUrlForKey("loops/a.mp4").startsWith(MEDIA_URL_PREFIX)).toBe(
      true,
    );
  });

  it("포스터는 영상과 다른 캐시에 담는다", () => {
    expect(mediaCacheNameFor(mediaUrlForKey("posters/a.webp"))).toBe(
      POSTER_CACHE_NAME,
    );
    expect(mediaCacheNameFor(mediaUrlForKey("loops/a.mp4"))).toBe(
      MEDIA_CACHE_NAME,
    );
    expect(mediaCacheNameFor(mediaUrlForKey("stills/a.jpg"))).toBe(
      MEDIA_CACHE_NAME,
    );
  });
});
