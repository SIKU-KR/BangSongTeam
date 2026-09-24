import { describe, it, expect } from "vitest";
import {
  BACKGROUND_TAGS,
  BACKGROUND_UPLOAD_LIMITS,
  isBackgroundImageMimeType,
  isBackgroundVideoMimeType,
  mediaUrlForKey,
} from "./backgrounds";
import { MEDIA_URL_PREFIX } from "./projection";

describe("mediaUrlForKey", () => {
  it("R2 키를 동일 출처 미디어 프록시 경로로 바꾼다", () => {
    expect(mediaUrlForKey("loops/warm.mp4")).toBe("/api/media/loops/warm.mp4");
  });

  it("키 앞의 슬래시를 겹치지 않게 떼어 낸다", () => {
    expect(mediaUrlForKey("/stills/a.png")).toBe("/api/media/stills/a.png");
  });

  it("미디어 캐시 규칙이 보는 접두사로 시작한다", () => {
    expect(mediaUrlForKey("x.webp").startsWith(MEDIA_URL_PREFIX)).toBe(true);
  });
});

describe("배경 업로드 한도와 형식", () => {
  it("파일 하나는 30MB로 묶고, 계정 전체 한도는 두지 않는다", () => {
    expect(BACKGROUND_UPLOAD_LIMITS.maxFileBytes).toBe(30 * 1024 * 1024);
    expect(BACKGROUND_UPLOAD_LIMITS).not.toHaveProperty("maxAccountBytes");
  });

  it("영상은 MP4만, 이미지는 JPEG·PNG·WebP만 받는다", () => {
    expect(isBackgroundVideoMimeType("video/mp4")).toBe(true);
    expect(isBackgroundVideoMimeType("video/webm")).toBe(false);
    expect(isBackgroundImageMimeType("image/png")).toBe(true);
    expect(isBackgroundImageMimeType("image/gif")).toBe(false);
  });

  it("태그 선택지는 분위기 3종과 주조색 3종이다", () => {
    expect(BACKGROUND_TAGS).toEqual([
      "잔잔한",
      "밝은",
      "웅장한",
      "따뜻한",
      "차가운",
      "어두운",
    ]);
  });
});
