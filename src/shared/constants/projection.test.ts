import { describe, it, expect } from "vitest";
import {
  CDN_FONT_URL_PATTERN,
  MEDIA_CACHE_NAME,
  MEDIA_URL_PREFIX,
  POSTER_CACHE_NAME,
  mediaCacheNameFor,
} from "./projection";
import { mediaUrlForKey } from "./backgrounds";
import { NOONNU_FONTS } from "./noonnuFontCatalog";

function matchesFromStart(url: string): boolean {
  const href = new URL(url, "https://worship.example").href;
  return CDN_FONT_URL_PATTERN.exec(href)?.index === 0;
}

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

  it("눈누 카탈로그의 모든 글꼴 주소가 CDN 글꼴 캐시 규칙에 첫 글자부터 맞는다", () => {
    const unmatched = NOONNU_FONTS.map((font) => font.url).filter(
      (url) => !matchesFromStart(url),
    );
    expect(unmatched).toEqual([]);
  });

  it("Google 글꼴 CSS가 가리키는 글꼴 파일 호스트도 캐시한다", () => {
    expect(
      matchesFromStart("https://fonts.gstatic.com/s/notosanskr/v1/a.woff2"),
    ).toBe(true);
  });

  it("자체 오리진 경로나 다른 호스트는 CDN 글꼴 캐시에 담지 않는다", () => {
    expect(CDN_FONT_URL_PATTERN.test("/assets/pretendard.woff2")).toBe(false);
    expect(
      matchesFromStart("https://evil.example/cdn.jsdelivr.net/a.woff2"),
    ).toBe(false);
    expect(
      matchesFromStart("https://cdn.jsdelivr.net.evil.example/a.woff2"),
    ).toBe(false);
  });
});
