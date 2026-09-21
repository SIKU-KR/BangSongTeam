import { describe, it, expect } from "vitest";
import { BackgroundMediaSchema, BackgroundsQuerySchema } from "./media";
import { LyricCatalogSchema } from "./catalog";

describe("Media & Catalog Schemas", () => {
  it("parses BackgroundMediaSchema correctly", () => {
    const valid = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      title: "Warm Loop 01",
      r2Key: "videos/warm_01.mp4",
      posterKey: "posters/warm_01.webp",
      durationSec: 30,
      license: "CC0",
      tags: ["잔잔한", "따뜻한"],
      cdnUrl: "https://media.domain.com/videos/warm_01.mp4",
      posterUrl: "https://media.domain.com/posters/warm_01.webp",
    };
    expect(BackgroundMediaSchema.parse(valid)).toEqual(valid);
  });

  it("parses LyricCatalogSchema with defaults", () => {
    const valid = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      title: "은혜로다",
      artist: "예수전도단",
      titleNorm: "은혜로다",
      artistNorm: "예수전도단",
      lyricsCanonical: "시작됐네 우리 주님의 능력이",
      normalizedAt: null,
    };
    const parsed = LyricCatalogSchema.parse(valid);
    expect(parsed.status).toBe("single");
    expect(parsed.versionCount).toBe(1);
    expect(parsed.normalizedAt).toBeNull();
  });
});

describe("BackgroundsQuerySchema", () => {
  it("모든 파라미터가 선택 사항이다", () => {
    expect(BackgroundsQuerySchema.parse({})).toEqual({});
  });

  it("limit 문자열을 숫자로 변환한다", () => {
    expect(BackgroundsQuerySchema.parse({ limit: "5" }).limit).toBe(5);
  });

  it("limit은 1~100 정수만 허용한다", () => {
    expect(() => BackgroundsQuerySchema.parse({ limit: "0" })).toThrow();
    expect(() => BackgroundsQuerySchema.parse({ limit: "101" })).toThrow();
    expect(() => BackgroundsQuerySchema.parse({ limit: "abc" })).toThrow();
    expect(() => BackgroundsQuerySchema.parse({ limit: "1.5" })).toThrow();
  });

  it("q와 tag는 앞뒤 공백을 제거하고 길이를 제한한다", () => {
    expect(
      BackgroundsQuerySchema.parse({ q: "  호수 ", tag: " 잔잔한 " }),
    ).toEqual({ q: "호수", tag: "잔잔한" });
    expect(() => BackgroundsQuerySchema.parse({ q: "a".repeat(51) })).toThrow();
    expect(() =>
      BackgroundsQuerySchema.parse({ tag: "a".repeat(31) }),
    ).toThrow();
  });
});
