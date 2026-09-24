import { describe, it, expect } from "vitest";
import { PresentationSchema, PresentationItemSchema } from "./presentation";

describe("PresentationSchema", () => {
  const sampleItem = {
    id: "d0eebc9996bb9bd380a44",
    presentationId: "e0eebc9996bb9bd380a55",
    deckId: "f0eebc9996bb9bd380a66",
    order: 0,
  };

  const samplePresentation = {
    id: "e0eebc9996bb9bd380a55",
    userId: "b0eebc9996bb9bd380a22",
    title: "2026-09-27 주일 3부 예배",
    serviceDate: "2026-09-27",
    items: [sampleItem],
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };

  it("parses valid PresentationItemSchema directly", () => {
    expect(PresentationItemSchema.parse(sampleItem)).toEqual(sampleItem);
  });

  it("parses valid presentation and presentation items", () => {
    const parsed = PresentationSchema.parse(samplePresentation);
    expect(parsed.serviceDate).toBe("2026-09-27");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].order).toBe(0);
  });

  it("defaults items to empty array when omitted", () => {
    const withoutItems = {
      id: samplePresentation.id,
      userId: samplePresentation.userId,
      title: samplePresentation.title,
      serviceDate: samplePresentation.serviceDate,
      createdAt: samplePresentation.createdAt,
      updatedAt: samplePresentation.updatedAt,
    };
    const parsed = PresentationSchema.parse(withoutItems);
    expect(parsed.items).toEqual([]);
  });

  it("validates YYYY-MM-DD serviceDate regex", () => {
    expect(() =>
      PresentationSchema.parse({
        ...samplePresentation,
        serviceDate: "2026/09/27",
      }),
    ).toThrow();

    expect(() =>
      PresentationSchema.parse({
        ...samplePresentation,
        serviceDate: "2026-9-27",
      }),
    ).toThrow();

    expect(() =>
      PresentationSchema.parse({
        ...samplePresentation,
        serviceDate: "invalid",
      }),
    ).toThrow();
  });
});
