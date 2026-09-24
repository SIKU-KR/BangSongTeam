import { describe, it, expect } from "vitest";
import {
  CreateReportRequestSchema,
  PublicDeckDetailSchema,
  VisibilityUpdateRequestSchema,
} from "./library";

const ID = "a0eebc9996bb9bd380a11";

describe("VisibilityUpdateRequestSchema", () => {
  it("requires the copyright notice consent to be literally true when publishing", () => {
    expect(
      VisibilityUpdateRequestSchema.parse({
        visibility: "public",
        acceptedCopyrightNotice: true,
      }),
    ).toEqual({ visibility: "public", acceptedCopyrightNotice: true });

    expect(() =>
      VisibilityUpdateRequestSchema.parse({
        visibility: "public",
        acceptedCopyrightNotice: false,
      }),
    ).toThrow();
    expect(() =>
      VisibilityUpdateRequestSchema.parse({ visibility: "public" }),
    ).toThrow();
  });

  it("allows going private without consent", () => {
    expect(
      VisibilityUpdateRequestSchema.parse({ visibility: "private" }),
    ).toEqual({ visibility: "private" });
  });
});

describe("PublicDeckDetailSchema", () => {
  it("includes the full lyrics and slides but never the owner id", () => {
    const parsed = PublicDeckDetailSchema.parse({
      id: ID,
      title: "은혜로다",
      artist: "예수전도단",
      authorName: "김찬양",
      forkedFromAuthorName: null,
      forkCount: 3,
      backgroundId: null,
      firstSlidePreview: ["첫 줄"],
      slideCount: 1,
      updatedAt: "2026-09-23T00:00:00.000Z",
      lyricsRaw: "첫 줄",
      slides: [{ order: 0, lines: ["첫 줄"] }],
      style: {},
      userId: "00000000x000000000001",
    });
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.style.fontFamily).toBe("Pretendard");
    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("CreateReportRequestSchema", () => {
  it("accepts every report reason including manual corrections", () => {
    for (const reason of [
      "lyrics_error",
      "inappropriate",
      "copyright",
      "correction",
    ]) {
      expect(
        CreateReportRequestSchema.parse({
          targetType: "deck",
          targetId: ID,
          reason,
        }).reason,
      ).toBe(reason);
    }
  });

  it("rejects unknown targets, reasons and oversize details", () => {
    expect(() =>
      CreateReportRequestSchema.parse({
        targetType: "user",
        targetId: ID,
        reason: "copyright",
      }),
    ).toThrow();
    expect(() =>
      CreateReportRequestSchema.parse({
        targetType: "deck",
        targetId: ID,
        reason: "spam",
      }),
    ).toThrow();
    expect(() =>
      CreateReportRequestSchema.parse({
        targetType: "deck",
        targetId: ID,
        reason: "copyright",
        details: "가".repeat(501),
      }),
    ).toThrow();
  });
});
