import { describe, it, expect } from "vitest";
import { ID_PATTERN, PresentationSchema } from "@repo/shared";
import { mockPresentation } from "./mockPresentation";

describe("mockPresentation (Task 3.1)", () => {
  it("PresentationSchema.parse를 통과하고 유효한 프레젠테이션 스키마를 만족해야 한다", () => {
    const parsed = PresentationSchema.parse(mockPresentation);
    expect(parsed.id).toBeDefined();
    expect(parsed.title).toBe("2026 주일 3부 예배");
    expect(parsed.items).toHaveLength(5);
  });

  it("5곡의 대표 찬양 덱이 올바른 순서와 정보를 가져야 한다", () => {
    const titles = mockPresentation.items.map((item) => item.deck?.title);
    expect(titles).toEqual([
      "은혜로다",
      "주 품에",
      "시선",
      "꽃들도",
      "주의 이름 높이며",
    ]);

    mockPresentation.items.forEach((item, index) => {
      expect(item.order).toBe(index);
      expect(item.deck).toBeDefined();
      expect(item.deckId).toBe(item.deck?.id);
    });
  });

  it("모든 덱은 3~5개의 슬라이드를 가지고, 슬라이드당 최대 4줄 제약을 준수해야 한다", () => {
    for (const item of mockPresentation.items) {
      const deck = item.deck;
      expect(deck).toBeDefined();
      expect(deck!.slides.length).toBeGreaterThanOrEqual(3);
      expect(deck!.slides.length).toBeLessThanOrEqual(5);

      deck!.slides.forEach((slide, idx) => {
        expect(slide.order).toBe(idx);
        expect(slide.lines.length).toBeGreaterThanOrEqual(1);
        expect(slide.lines.length).toBeLessThanOrEqual(4);
        slide.lines.forEach((line) => {
          expect(line.trim().length).toBeGreaterThan(0);
        });
      });
    }
  });

  it("모든 덱은 모션 배경 ID 및 유효한 스타일을 가져야 한다", () => {
    for (const item of mockPresentation.items) {
      const deck = item.deck;
      expect(deck?.backgroundId).toMatch(ID_PATTERN);
      expect(deck?.style).toBeDefined();
      expect(deck?.style.fontFamily).toBe("Pretendard");
    }
  });
});
