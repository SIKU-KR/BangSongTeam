import { describe, it, expect } from "vitest";
import { DeckSchema, DeckScopeSchema } from "./deck";

describe("DeckSchema", () => {
  it("validates DeckScopeSchema options", () => {
    expect(DeckScopeSchema.parse("library")).toBe("library");
    expect(DeckScopeSchema.parse("presentation")).toBe("presentation");
    expect(() => DeckScopeSchema.parse("other")).toThrow();
  });

  const sampleDeck = {
    id: "a0eebc9996bb9bd380a11",
    userId: "b0eebc9996bb9bd380a22",
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: "시작됐네 우리 주님의 능력이\n나의 삶을 다스리시네",
    slides: [
      {
        order: 0,
        lines: ["시작됐네 우리 주님의 능력이", "나의 삶을 다스리시네"],
      },
    ],
    backgroundId: null,
    style: {},
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };

  it("parses a minimal valid deck with defaults applied", () => {
    const parsed = DeckSchema.parse(sampleDeck);
    expect(parsed.scope).toBe("library");
    expect(parsed.style.fontFamily).toBe("Pretendard");
    expect(parsed.slides[0].id).toMatch(/^s_/);
  });

  it("keeps the source author snapshot", () => {
    const parsed = DeckSchema.parse({
      ...sampleDeck,
      forkedFromAuthorName: "김찬양",
    });
    expect(parsed.forkedFromAuthorName).toBe("김찬양");
  });

  it("drops the retired public-library fields that old saved decks still carry", () => {
    const parsed = DeckSchema.parse({
      ...sampleDeck,
      visibility: "public",
      forkCount: 3,
      origin: "catalog",
      publishedAt: "2026-09-23T00:00:00.000Z",
      takedownAt: null,
      catalogId: "d00000000000000000001",
      contributeToCatalog: true,
    });
    for (const key of [
      "visibility",
      "forkCount",
      "origin",
      "publishedAt",
      "takedownAt",
      "catalogId",
      "contributeToCatalog",
    ]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it("allows presentation scope and presentationId", () => {
    const presentationDeck = {
      ...sampleDeck,
      scope: "presentation" as const,
      presentationId: "c0eebc9996bb9bd380a33",
      forkedFrom: "a0eebc9996bb9bd380a11",
    };
    const parsed = DeckSchema.parse(presentationDeck);
    expect(parsed.scope).toBe("presentation");
    expect(parsed.presentationId).toBe("c0eebc9996bb9bd380a33");
    expect(parsed.forkedFrom).toBe("a0eebc9996bb9bd380a11");
  });

  it("rejects invalid ids (including legacy UUIDs) or dates", () => {
    expect(() =>
      DeckSchema.parse({
        ...sampleDeck,
        id: "invalid-id",
      }),
    ).toThrow();

    expect(() =>
      DeckSchema.parse({
        ...sampleDeck,
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      }),
    ).toThrow();

    expect(() =>
      DeckSchema.parse({
        ...sampleDeck,
        createdAt: "invalid-date",
      }),
    ).toThrow();
  });
});
