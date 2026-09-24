import type { PresentationItem, Slide } from "@repo/shared";

/**
 * 송출 위치 계산 (순수 함수).
 *
 * 단독 전체화면·조작 창·청중 창 셋이 같은 규칙으로 움직여야 한다. 라우트 안에
 * 두면 같은 로직이 세 벌이 되고, 한쪽만 고친 순간 조작 창과 청중 화면이 다른
 * 슬라이드를 가리킨다.
 */

export interface ProjectionPosition {
  songIndex: number;
  slideIndex: number;
}

export const INITIAL_POSITION: ProjectionPosition = {
  songIndex: 0,
  slideIndex: 0,
};

type Songs = readonly PresentationItem[];

function slideCountOf(songs: Songs, songIndex: number): number {
  return songs[songIndex]?.deck?.slides.length ?? 0;
}

/** 곡별 슬라이드 수 (번호 점프 검증·조작 창 목록용) */
export function getSongSlideCounts(songs: Songs): number[] {
  return songs.map((_, index) => slideCountOf(songs, index));
}

/** 세트 전체 슬라이드 수 (번호 점프의 상한) */
export function getTotalSlideCount(songs: Songs): number {
  return getSongSlideCounts(songs).reduce((sum, count) => sum + count, 0);
}

/**
 * 세트 전체에서 1부터 이어지는 슬라이드 번호 (PPT식).
 *
 * 조작자가 보는 번호와 숫자 키패드로 치는 번호가 같아야 하므로, 화면 표시와
 * 번호 점프가 모두 이 함수와 `positionOfSlideNumber`를 거친다.
 * 슬라이드가 없는 자리(빈 곡)는 번호가 없으므로 null.
 */
export function slideNumberOf(
  position: ProjectionPosition,
  songs: Songs,
): number | null {
  if (!getSlideAt(position, songs)) return null;
  const before = getSongSlideCounts(songs)
    .slice(0, position.songIndex)
    .reduce((sum, count) => sum + count, 0);
  return before + position.slideIndex + 1;
}

/**
 * 전체 번호 → 곡·슬라이드 위치. 범위 밖이면 null.
 * 슬라이드가 0장인 곡은 번호를 차지하지 않고 건너뛴다.
 */
export function positionOfSlideNumber(
  slideNumber: number,
  songs: Songs,
): ProjectionPosition | null {
  if (!Number.isInteger(slideNumber) || slideNumber < 1) return null;

  let remaining = slideNumber - 1;
  const counts = getSongSlideCounts(songs);
  for (let songIndex = 0; songIndex < counts.length; songIndex++) {
    if (remaining < counts[songIndex]) {
      return { songIndex, slideIndex: remaining };
    }
    remaining -= counts[songIndex];
  }
  return null;
}

/** 현재 위치의 슬라이드. 없으면 null */
export function getSlideAt(
  position: ProjectionPosition,
  songs: Songs,
): Slide | null {
  return songs[position.songIndex]?.deck?.slides[position.slideIndex] ?? null;
}

/**
 * 범위를 벗어난 위치를 안전한 값으로 되돌린다.
 *
 * 브로드캐스트로 들어온 인덱스를 그대로 믿으면, 조작 창과 청중 창이 서로 다른
 * 세트를 들고 있을 때(한쪽만 편집 후 새로고침) 빈 화면이 뜬다.
 */
export function clampPosition(
  position: ProjectionPosition,
  songs: Songs,
): ProjectionPosition {
  if (songs.length === 0) return INITIAL_POSITION;

  const songIndex = Math.min(
    Math.max(0, Math.trunc(position.songIndex)),
    songs.length - 1,
  );
  const slideCount = slideCountOf(songs, songIndex);
  if (slideCount === 0) return { songIndex, slideIndex: 0 };

  const slideIndex = Math.min(
    Math.max(0, Math.trunc(position.slideIndex)),
    slideCount - 1,
  );
  return { songIndex, slideIndex };
}

/**
 * 다음 슬라이드. 곡 마지막이면 다음 곡 첫 슬라이드로 넘어간다.
 * 세트 끝에서는 움직이지 않는다 (예배 중 의도치 않게 화면이 비면 안 된다).
 */
export function nextPosition(
  position: ProjectionPosition,
  songs: Songs,
): ProjectionPosition {
  const current = clampPosition(position, songs);
  const slideCount = slideCountOf(songs, current.songIndex);

  if (current.slideIndex < slideCount - 1) {
    return { ...current, slideIndex: current.slideIndex + 1 };
  }
  if (current.songIndex < songs.length - 1) {
    return { songIndex: current.songIndex + 1, slideIndex: 0 };
  }
  return current;
}

/**
 * 이전 슬라이드. 곡 첫 슬라이드면 이전 곡의 **마지막** 슬라이드로 돌아간다.
 */
export function prevPosition(
  position: ProjectionPosition,
  songs: Songs,
): ProjectionPosition {
  const current = clampPosition(position, songs);

  if (current.slideIndex > 0) {
    return { ...current, slideIndex: current.slideIndex - 1 };
  }
  if (current.songIndex > 0) {
    const prevSongIndex = current.songIndex - 1;
    const prevSlideCount = slideCountOf(songs, prevSongIndex);
    return {
      songIndex: prevSongIndex,
      slideIndex: Math.max(0, prevSlideCount - 1),
    };
  }
  return current;
}

/** 두 위치가 같은 슬라이드를 가리키는지 */
export function isSamePosition(
  a: ProjectionPosition,
  b: ProjectionPosition,
): boolean {
  return a.songIndex === b.songIndex && a.slideIndex === b.slideIndex;
}

/**
 * 조작 창의 '다음 슬라이드' 미리보기용.
 * 세트 마지막이면 null (더 보여 줄 것이 없다).
 */
export function peekNext(
  position: ProjectionPosition,
  songs: Songs,
): ProjectionPosition | null {
  const next = nextPosition(position, songs);
  return isSamePosition(next, clampPosition(position, songs)) ? null : next;
}
