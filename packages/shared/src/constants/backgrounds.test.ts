import { describe, it, expect } from "vitest";
import {
  INITIAL_BACKGROUNDS,
  DEFAULT_BACKGROUND_ID,
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
} from "./backgrounds";

describe("Background Constants & Helpers", () => {
  it("should have exactly 10 initial background definitions", () => {
    expect(INITIAL_BACKGROUNDS).toHaveLength(10);
    expect(DEFAULT_BACKGROUND_ID).toBe(INITIAL_BACKGROUNDS[0].id);
  });

  it("should generate correct media URL and poster URL", () => {
    const first = INITIAL_BACKGROUNDS[0];
    const mediaUrl = getBackgroundMediaUrl(first.id);
    const posterUrl = getBackgroundPosterUrl(first.id);

    expect(mediaUrl).toBe(`/api/media/${first.r2Key}`);
    expect(posterUrl).toBe(`/api/media/${first.posterKey}`);
  });

  it("should support custom baseUrl", () => {
    const first = INITIAL_BACKGROUNDS[0];
    const mediaUrl = getBackgroundMediaUrl(
      first.id,
      "https://media.worship-slide.com",
    );
    expect(mediaUrl).toBe(`https://media.worship-slide.com/${first.r2Key}`);
  });

  it("should return undefined for null, undefined, or unknown backgroundId", () => {
    expect(getBackgroundMediaUrl(null)).toBeUndefined();
    expect(getBackgroundMediaUrl(undefined)).toBeUndefined();
    expect(getBackgroundMediaUrl("unknown-id")).toBeUndefined();
    expect(getBackgroundPosterUrl(null)).toBeUndefined();
    expect(getBackgroundPosterUrl(undefined)).toBeUndefined();
    expect(getBackgroundPosterUrl("unknown-id")).toBeUndefined();
  });
});
