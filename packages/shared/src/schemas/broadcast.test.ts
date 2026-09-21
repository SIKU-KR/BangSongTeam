import { describe, it, expect } from "vitest";
import { BroadcastMessageSchema } from "./broadcast";

describe("BroadcastMessageSchema", () => {
  const timestamp = Date.now();

  it("validates AUDIENCE_MOUNTED message", () => {
    const msg = {
      type: "AUDIENCE_MOUNTED",
      timestamp,
    };
    expect(BroadcastMessageSchema.parse(msg)).toEqual(msg);
  });

  it("validates SYNC_SNAPSHOT message", () => {
    const msg = {
      type: "SYNC_SNAPSHOT",
      timestamp,
      payload: {
        presentationId: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
        currentSongIndex: 1,
        currentSlideIndex: 3,
        isBlackout: false,
        isLyricsHidden: true,
      },
    };
    expect(BroadcastMessageSchema.parse(msg)).toEqual(msg);
  });

  it("validates NAVIGATE_SLIDE message", () => {
    const msg = {
      type: "NAVIGATE_SLIDE",
      timestamp,
      payload: {
        songIndex: 2,
        slideIndex: 0,
      },
    };
    expect(BroadcastMessageSchema.parse(msg)).toEqual(msg);
  });

  it("validates SET_BLACKOUT message", () => {
    const msg = {
      type: "SET_BLACKOUT",
      timestamp,
      payload: {
        isBlackout: true,
      },
    };
    expect(BroadcastMessageSchema.parse(msg)).toEqual(msg);
  });

  it("validates SET_LYRICS_HIDDEN message", () => {
    const msg = {
      type: "SET_LYRICS_HIDDEN",
      timestamp,
      payload: {
        isLyricsHidden: true,
      },
    };
    expect(BroadcastMessageSchema.parse(msg)).toEqual(msg);
  });

  it("validates HEARTBEAT message", () => {
    const msg = {
      type: "HEARTBEAT",
      timestamp,
    };
    expect(BroadcastMessageSchema.parse(msg)).toEqual(msg);
  });

  it("rejects unknown message types", () => {
    expect(() =>
      BroadcastMessageSchema.parse({
        type: "UNKNOWN_TYPE",
        timestamp,
      }),
    ).toThrow();
  });

  it("rejects invalid payload for known message type", () => {
    expect(() =>
      BroadcastMessageSchema.parse({
        type: "NAVIGATE_SLIDE",
        timestamp,
        payload: {
          songIndex: -1, // negative not allowed
          slideIndex: 0,
        },
      }),
    ).toThrow();

    expect(() =>
      BroadcastMessageSchema.parse({
        type: "SYNC_SNAPSHOT",
        timestamp,
        payload: {
          presentationId: "not-a-uuid",
          currentSongIndex: 0,
          currentSlideIndex: 0,
          isBlackout: false,
          isLyricsHidden: false,
        },
      }),
    ).toThrow();
  });
});
