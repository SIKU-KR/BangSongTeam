import { describe, it, expect } from "vitest";
import { sniffBackgroundMimeType, userBackgroundKeys } from "./backgroundFiles";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const ascii = (text: string): number[] =>
  [...text].map((char) => char.charCodeAt(0));

describe("sniffBackgroundMimeType", () => {
  it("MP4는 4번째 바이트부터 ftyp 상자가 온다", () => {
    expect(
      sniffBackgroundMimeType(bytes(0, 0, 0, 0x20, ...ascii("ftypisom"))),
    ).toBe("video/mp4");
  });

  it("JPEG·PNG·WebP 서명을 알아본다", () => {
    expect(sniffBackgroundMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(
      "image/jpeg",
    );
    expect(
      sniffBackgroundMimeType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      ),
    ).toBe("image/png");
    expect(
      sniffBackgroundMimeType(
        bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")),
      ),
    ).toBe("image/webp");
  });

  it("확장자만 바꾼 파일은 알아보지 못한다", () => {
    expect(sniffBackgroundMimeType(bytes(...ascii("GIF89a")))).toBeNull();
    expect(sniffBackgroundMimeType(bytes())).toBeNull();
  });
});

describe("userBackgroundKeys", () => {
  it("사용자와 배경 id 아래에 영상과 포스터를 나란히 둔다", () => {
    expect(
      userBackgroundKeys("user-1", "bg-1", "video/mp4", "image/webp"),
    ).toEqual({
      mediaKey: "uploads/user-1/bg-1.mp4",
      posterKey: "uploads/user-1/bg-1.poster.webp",
    });
  });

  it("이미지는 원본을 포스터로 함께 쓴다", () => {
    expect(userBackgroundKeys("user-1", "bg-1", "image/png", null)).toEqual({
      mediaKey: "uploads/user-1/bg-1.png",
      posterKey: "uploads/user-1/bg-1.png",
    });
  });
});
