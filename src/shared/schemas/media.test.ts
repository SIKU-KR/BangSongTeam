import { describe, it, expect } from "vitest";
import {
  BackgroundListResponseSchema,
  BackgroundMediaSchema,
  BackgroundUploadFormSchema,
} from "./media";

const VALID_BACKGROUND = {
  id: "a0eebc9996bb9bd380a11",
  title: "Warm Loop 01",
  source: "service",
  kind: "video",
  mediaUrl: "/api/media/loops/warm_01.mp4",
  posterUrl: "/api/media/posters/warm_01.webp",
  durationSec: 30,
  sizeBytes: 12_000_000,
  license: "CC0",
  tags: ["잔잔한", "따뜻한"],
  createdAt: "2026-09-24T00:00:00.000Z",
};

function file(bytes: number, type: string, name = "a"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function uploadForm(overrides: Record<string, unknown> = {}) {
  return {
    file: file(10, "video/mp4", "loop.mp4"),
    poster: file(10, "image/webp", "poster.webp"),
    title: "본당 배경",
    license: "Pexels License — 홍길동",
    tags: JSON.stringify(["잔잔한"]),
    durationSec: "12",
    acceptedRightsNotice: "true",
    ...overrides,
  };
}

describe("BackgroundMediaSchema", () => {
  it("동일 출처 미디어 프록시 URL을 가진 배경을 받는다", () => {
    expect(BackgroundMediaSchema.parse(VALID_BACKGROUND)).toEqual(
      VALID_BACKGROUND,
    );
  });

  it("커스텀 도메인 절대 URL은 받지 않는다", () => {
    expect(() =>
      BackgroundMediaSchema.parse({
        ...VALID_BACKGROUND,
        mediaUrl: "https://media.example.com/loops/warm_01.mp4",
      }),
    ).toThrow();
  });

  it("알 수 없는 출처나 종류는 거절한다", () => {
    expect(() =>
      BackgroundMediaSchema.parse({ ...VALID_BACKGROUND, source: "catalog" }),
    ).toThrow();
    expect(() =>
      BackgroundMediaSchema.parse({ ...VALID_BACKGROUND, kind: "gif" }),
    ).toThrow();
  });
});

describe("BackgroundListResponseSchema", () => {
  it("관리 권한 여부를 함께 받는다", () => {
    expect(
      BackgroundListResponseSchema.parse({
        backgrounds: [VALID_BACKGROUND],
        canManage: false,
      }).canManage,
    ).toBe(false);
  });

  it("관리 권한 여부가 빠지면 거절한다", () => {
    expect(() =>
      BackgroundListResponseSchema.parse({ backgrounds: [], usage: null }),
    ).toThrow();
  });
});

describe("BackgroundUploadFormSchema", () => {
  it("태그 JSON과 길이 문자열을 풀어서 받는다", () => {
    const parsed = BackgroundUploadFormSchema.parse(uploadForm());
    expect(parsed.tags).toEqual(["잔잔한"]);
    expect(parsed.durationSec).toBe(12);
    expect(parsed.title).toBe("본당 배경");
  });

  it("태그와 길이는 생략할 수 있다", () => {
    const parsed = BackgroundUploadFormSchema.parse(
      uploadForm({ tags: undefined, durationSec: undefined }),
    );
    expect(parsed.tags).toEqual([]);
    expect(parsed.durationSec).toBe(0);
  });

  it("출처·라이선스가 비어 있으면 거절한다", () => {
    expect(
      BackgroundUploadFormSchema.safeParse(uploadForm({ license: "  " }))
        .success,
    ).toBe(false);
  });

  it("라이선스 확인에 동의하지 않으면 거절한다", () => {
    const result = BackgroundUploadFormSchema.safeParse(
      uploadForm({ acceptedRightsNotice: "false" }),
    );
    expect(result.success).toBe(false);
  });

  it("허용하지 않는 형식은 거절한다", () => {
    const result = BackgroundUploadFormSchema.safeParse(
      uploadForm({ file: file(10, "image/gif", "a.gif"), poster: undefined }),
    );
    expect(result.success).toBe(false);
  });

  it("30MB를 넘는 파일은 거절한다", () => {
    const result = BackgroundUploadFormSchema.safeParse(
      uploadForm({ file: file(30 * 1024 * 1024 + 1, "video/mp4") }),
    );
    expect(result.success).toBe(false);
  });

  it("영상은 포스터가 없으면 거절하고 이미지는 포스터 없이 받는다", () => {
    expect(
      BackgroundUploadFormSchema.safeParse(uploadForm({ poster: undefined }))
        .success,
    ).toBe(false);
    expect(
      BackgroundUploadFormSchema.safeParse(
        uploadForm({ file: file(10, "image/png", "a.png"), poster: undefined }),
      ).success,
    ).toBe(true);
  });

  it("태그는 6개까지만 받는다", () => {
    const result = BackgroundUploadFormSchema.safeParse(
      uploadForm({ tags: JSON.stringify(["a", "b", "c", "d", "e", "f", "g"]) }),
    );
    expect(result.success).toBe(false);
  });

  it("빈 제목은 거절한다", () => {
    expect(
      BackgroundUploadFormSchema.safeParse(uploadForm({ title: "   " }))
        .success,
    ).toBe(false);
  });
});
