import { describe, it, expect } from "vitest";
import { PresentationSchema } from "@repo/shared";
import {
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
  MOCK_PRESENTATION_ID,
} from "./mockPresentations";

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
