import { describe, it, expect } from "vitest";
import type { PresentationItem } from "@repo/shared";
import {
  nextPosition,
  prevPosition,
  clampPosition,
  getSlideAt,
  getSongSlideCounts,
  isSamePosition,
  peekNext,
  INITIAL_POSITION,
} from "./projectionState";

/** slideCounts로 간단한 세트를 만든다 */
function makeSongs(slideCounts: number[]): PresentationItem[] {
  return slideCounts.map(
    (count, songIndex) =>
      ({
        id: `item-${songIndex}`,
        presentationId: "p",
        deckId: `deck-${songIndex}`,
        order: songIndex,
        deck: {
          id: `deck-${songIndex}`,
          slides: Array.from({ length: count }, (_, slideIndex) => ({
            id: `s-${songIndex}-${slideIndex}`,
            order: slideIndex,
            lines: [`곡${songIndex} 슬라이드${slideIndex}`],
          })),
        },
      }) as unknown as PresentationItem,
  );
}

const SONGS = makeSongs([3, 2, 4]);

describe("nextPosition", () => {
  it("곡 안에서는 슬라이드만 넘어간다", () => {
    expect(nextPosition({ songIndex: 0, slideIndex: 0 }, SONGS)).toEqual({
      songIndex: 0,
      slideIndex: 1,
    });
  });

  it("곡 마지막에서는 다음 곡 첫 슬라이드로 넘어간다", () => {
    expect(nextPosition({ songIndex: 0, slideIndex: 2 }, SONGS)).toEqual({
      songIndex: 1,
      slideIndex: 0,
    });
  });

  it("세트 마지막에서는 움직이지 않는다", () => {
    const last = { songIndex: 2, slideIndex: 3 };
    expect(nextPosition(last, SONGS)).toEqual(last);
  });

  it("빈 세트에서도 터지지 않는다", () => {
    expect(nextPosition({ songIndex: 0, slideIndex: 0 }, [])).toEqual(
      INITIAL_POSITION,
    );
  });
});

describe("prevPosition", () => {
  it("곡 안에서는 슬라이드만 되돌아간다", () => {
    expect(prevPosition({ songIndex: 1, slideIndex: 1 }, SONGS)).toEqual({
      songIndex: 1,
      slideIndex: 0,
    });
  });

  it("곡 첫 슬라이드에서는 이전 곡의 마지막 슬라이드로 간다", () => {
    expect(prevPosition({ songIndex: 1, slideIndex: 0 }, SONGS)).toEqual({
      songIndex: 0,
      slideIndex: 2,
    });
  });

  it("세트 처음에서는 움직이지 않는다", () => {
    expect(prevPosition(INITIAL_POSITION, SONGS)).toEqual(INITIAL_POSITION);
  });
});

describe("clampPosition", () => {
  it("범위를 넘는 곡 인덱스를 마지막 곡으로 붙인다", () => {
    expect(clampPosition({ songIndex: 99, slideIndex: 0 }, SONGS)).toEqual({
      songIndex: 2,
      slideIndex: 0,
    });
  });

  it("범위를 넘는 슬라이드 인덱스를 그 곡의 마지막으로 붙인다", () => {
    expect(clampPosition({ songIndex: 1, slideIndex: 99 }, SONGS)).toEqual({
      songIndex: 1,
      slideIndex: 1,
    });
  });

  it("음수를 0으로 되돌린다", () => {
    expect(clampPosition({ songIndex: -3, slideIndex: -2 }, SONGS)).toEqual(
      INITIAL_POSITION,
    );
  });

  it("슬라이드가 없는 곡은 0번으로 둔다", () => {
    const songs = makeSongs([0, 2]);
    expect(clampPosition({ songIndex: 0, slideIndex: 5 }, songs)).toEqual({
      songIndex: 0,
      slideIndex: 0,
    });
  });

  it("빈 세트는 초기 위치다", () => {
    expect(clampPosition({ songIndex: 4, slideIndex: 4 }, [])).toEqual(
      INITIAL_POSITION,
    );
  });
});

describe("조회 헬퍼", () => {
  it("현재 위치의 슬라이드를 돌려준다", () => {
    expect(getSlideAt({ songIndex: 1, slideIndex: 1 }, SONGS)?.lines).toEqual([
      "곡1 슬라이드1",
    ]);
  });

  it("없는 위치는 null이다", () => {
    expect(getSlideAt({ songIndex: 9, slideIndex: 9 }, SONGS)).toBeNull();
  });

  it("곡별 슬라이드 수를 센다", () => {
    expect(getSongSlideCounts(SONGS)).toEqual([3, 2, 4]);
  });

  it("같은 위치를 판별한다", () => {
    expect(
      isSamePosition({ songIndex: 1, slideIndex: 2 }, { songIndex: 1, slideIndex: 2 }),
    ).toBe(true);
    expect(
      isSamePosition({ songIndex: 1, slideIndex: 2 }, { songIndex: 1, slideIndex: 3 }),
    ).toBe(false);
  });
});

describe("peekNext", () => {
  it("다음 위치를 미리 알려 준다", () => {
    expect(peekNext({ songIndex: 0, slideIndex: 2 }, SONGS)).toEqual({
      songIndex: 1,
      slideIndex: 0,
    });
  });

  it("세트 마지막에서는 null이다", () => {
    expect(peekNext({ songIndex: 2, slideIndex: 3 }, SONGS)).toBeNull();
  });
});
