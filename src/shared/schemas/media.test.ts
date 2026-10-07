import { describe, it, expect } from "vitest";
import { BackgroundMediaSchema } from "./media";

const VALID_BACKGROUND = {
  id: "a0eebc9996bb9bd380a11",
  title: "Warm Loop 01",
  kind: "video",
  mediaUrl: "/api/media/loops/warm_01.mp4",
  posterUrl: "/api/media/posters/warm_01.webp",
  durationSec: 30,
  sizeBytes: 12_000_000,
  license: "CC0",
  createdAt: "2026-09-24T00:00:00.000Z",
  description: "따뜻한 빛이 천천히 번져요.",
  keywords: ["따뜻한", "빛"],
};

describe("BackgroundMediaSchema", () => {
  it("동일 출처 미디어 프록시 URL을 가진 배경을 받는다", () => {
    expect(BackgroundMediaSchema.parse(VALID_BACKGROUND)).toEqual(
      VALID_BACKGROUND,
    );
  });

  it("검색 메타데이터가 없는 예전 로컬 사본도 빈 값으로 받는다", () => {
    const { description, keywords, ...legacy } = VALID_BACKGROUND;
    void description;
    void keywords;
    expect(BackgroundMediaSchema.parse(legacy)).toMatchObject({
      description: "",
      keywords: [],
    });
  });

  it("커스텀 도메인 절대 URL은 받지 않는다", () => {
    expect(() =>
      BackgroundMediaSchema.parse({
        ...VALID_BACKGROUND,
        mediaUrl: "https://media.example.com/loops/warm_01.mp4",
      }),
    ).toThrow();
  });

  it("알 수 없는 종류는 거절한다", () => {
    expect(() =>
      BackgroundMediaSchema.parse({ ...VALID_BACKGROUND, kind: "gif" }),
    ).toThrow();
  });
});
