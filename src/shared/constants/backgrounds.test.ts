import { describe, it, expect } from "vitest";
import { mediaUrlForKey } from "./backgrounds";
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
