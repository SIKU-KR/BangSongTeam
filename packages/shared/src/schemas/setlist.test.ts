import { describe, it, expect } from "vitest";
import { SetlistSchema, SetlistItemSchema } from "./setlist";

describe("SetlistSchema", () => {
  const sampleItem = {
    id: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
    setlistId: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
    deckId: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66",
    order: 0,
  };

  const sampleSetlist = {
    id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
    userId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
    title: "2026-09-27 주일 3부 예배",
    serviceDate: "2026-09-27",
    items: [sampleItem],
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };

  it("parses valid SetlistItemSchema directly", () => {
    expect(SetlistItemSchema.parse(sampleItem)).toEqual(sampleItem);
  });

  it("parses valid setlist and setlist items", () => {
    const parsed = SetlistSchema.parse(sampleSetlist);
    expect(parsed.serviceDate).toBe("2026-09-27");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].order).toBe(0);
  });

  it("defaults items to empty array when omitted", () => {
    const withoutItems = {
      id: sampleSetlist.id,
      userId: sampleSetlist.userId,
      title: sampleSetlist.title,
      serviceDate: sampleSetlist.serviceDate,
      createdAt: sampleSetlist.createdAt,
      updatedAt: sampleSetlist.updatedAt,
    };
    const parsed = SetlistSchema.parse(withoutItems);
    expect(parsed.items).toEqual([]);
  });

  it("validates YYYY-MM-DD serviceDate regex", () => {
    expect(() =>
      SetlistSchema.parse({
        ...sampleSetlist,
        serviceDate: "2026/09/27",
      }),
    ).toThrow();

    expect(() =>
      SetlistSchema.parse({
        ...sampleSetlist,
        serviceDate: "2026-9-27",
      }),
    ).toThrow();

    expect(() =>
      SetlistSchema.parse({
        ...sampleSetlist,
        serviceDate: "invalid",
      }),
    ).toThrow();
  });
});
