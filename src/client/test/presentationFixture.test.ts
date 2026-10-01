import { describe, it, expect } from "vitest";
import { PresentationSchema } from "#shared";
import {
  mockPresentation,
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
  MOCK_PRESENTATION_ID,
} from "./presentationFixture";

describe("mockPresentation", () => {
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

  it("샘플 곡은 배경 없이 두고(세트에 담을 때 기본 제공 배경을 배정받는다) 유효한 스타일을 가진다", () => {
    for (const item of mockPresentation.items) {
      const deck = item.deck;
      expect(deck?.backgroundId).toBeNull();
      expect(deck?.style).toBeDefined();
      expect(deck?.style.fontFamily).toBe("Pretendard");
    }
  });
});

describe("mockPresentations (멀티 문서 시드)", () => {
  it("시드 5개가 모두 PresentationSchema를 통과한다", () => {
    expect(SEED_PRESENTATIONS).toHaveLength(5);
    for (const presentation of SEED_PRESENTATIONS) {
      expect(() => PresentationSchema.parse(presentation)).not.toThrow();
    }
  });

  it("첫 번째 시드는 기존 mockPresentation (5곡 23슬라이드)이다", () => {
    const first = SEED_PRESENTATIONS[0];
    expect(first.id).toBe(MOCK_PRESENTATION_ID);
    expect(first.title).toBe("2026 주일 3부 예배");
    expect(first.items).toHaveLength(5);
    const slideCount = first.items.reduce(
      (sum, item) => sum + (item.deck?.slides.length ?? 0),
      0,
    );
    expect(slideCount).toBe(23);
  });

  it("프레젠테이션 id가 서로 겹치지 않는다", () => {
    expect(new Set(SEED_PRESENTATION_IDS).size).toBe(
      SEED_PRESENTATION_IDS.length,
    );
  });

  it("아이템 id와 덱 id가 시드 전체에 걸쳐 유니크하다", () => {
    const itemIds = SEED_PRESENTATIONS.flatMap((p) => p.items.map((i) => i.id));
    const deckIds = SEED_PRESENTATIONS.flatMap((p) =>
      p.items.map((i) => i.deckId),
    );
    expect(new Set(itemIds).size).toBe(itemIds.length);
    expect(new Set(deckIds).size).toBe(deckIds.length);
  });

  it("각 아이템의 presentationId와 deck.presentationId가 소속 문서를 가리킨다", () => {
    for (const presentation of SEED_PRESENTATIONS) {
      for (const item of presentation.items) {
        expect(item.presentationId).toBe(presentation.id);
        expect(item.deck?.presentationId).toBe(presentation.id);
        expect(item.deck?.id).toBe(item.deckId);
      }
    }
  });

  it("파생 시드는 updatedAt 내림차순으로 mockPresentation 다음에 온다", () => {
    const timestamps = SEED_PRESENTATIONS.map((p) => p.updatedAt);
    const sorted = [...timestamps].sort((a, b) => b.localeCompare(a));
    expect(timestamps).toEqual(sorted);
  });
});
