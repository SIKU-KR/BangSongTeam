import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Presentation, SupportedFont } from "#shared";
import { mockPresentation } from "../../test/presentationFixture";
import { warmPresentationFonts } from "./fontWarmup";

const PRETENDARD_FACES = [
  '400 1rem "Pretendard Variable", "Pretendard"',
  '700 1rem "Pretendard Variable", "Pretendard"',
];

const BLACK_HAN_SANS_FACES = [
  '400 1rem "Black Han Sans", "검은고딕"',
  '700 1rem "Black Han Sans", "검은고딕"',
];

const load = vi.fn<FontFaceSet["load"]>();

function presentationWithFonts(fonts: SupportedFont[]): Presentation {
  return {
    ...mockPresentation,
    items: fonts.map((fontFamily, index) => {
      const item = mockPresentation.items[index]!;
      const deck = item.deck!;
      return {
        ...item,
        deck: { ...deck, style: { ...deck.style, fontFamily } },
      };
    }),
  };
}

function requestedFaces(): string[] {
  return load.mock.calls.map(([font]) => font);
}

function stylesheetLink(fontId: string): Promise<HTMLLinkElement> {
  return vi.waitFor(() => {
    const link = document.querySelector<HTMLLinkElement>(
      `link[data-noonnu-font-id="${fontId}"]`,
    );
    expect(link).not.toBeNull();
    return link!;
  });
}

describe("warmPresentationFonts", () => {
  beforeEach(() => {
    load.mockReset().mockResolvedValue([]);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "fonts");
    document
      .querySelectorAll("link[data-noonnu-font-id]")
      .forEach((link) => link.remove());
  });

  it("받는 중인 스타일시트가 있어도 다른 글꼴의 가사 글자는 기다리지 않고 미리 받는다", async () => {
    const warming = warmPresentationFonts(
      presentationWithFonts(["검은고딕", "Pretendard"]),
    );

    const pending = await stylesheetLink("106");
    await vi.waitFor(() => {
      expect(requestedFaces()).toEqual(PRETENDARD_FACES);
    });

    pending.dispatchEvent(new Event("load"));
    await warming;

    expect(requestedFaces()).toEqual([
      ...PRETENDARD_FACES,
      ...BLACK_HAN_SANS_FACES,
    ]);
  });
});
