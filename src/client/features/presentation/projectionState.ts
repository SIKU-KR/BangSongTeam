import type { PresentationItem, Slide } from "#shared";

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

/** 세트 전체 슬라이드 수 (번호 점프의 상한) */
export function getTotalSlideCount(songs: Songs): number {
  return songs.reduce((sum, _, index) => sum + slideCountOf(songs, index), 0);
}

/**
 * 세트 전체에서 1부터 이어지는 슬라이드 번호(PPT식) → 곡·슬라이드 위치.
 * 범위 밖이면 null. 슬라이드가 0장인 곡은 번호를 차지하지 않고 건너뛴다.
 */
export function positionOfSlideNumber(
  slideNumber: number,
  songs: Songs,
): ProjectionPosition | null {
  if (!Number.isInteger(slideNumber) || slideNumber < 1) return null;

  let remaining = slideNumber - 1;
  for (let songIndex = 0; songIndex < songs.length; songIndex++) {
    const count = slideCountOf(songs, songIndex);
    if (remaining < count) return { songIndex, slideIndex: remaining };
    remaining -= count;
  }
  return null;
}

/**
 * 곡·슬라이드 위치 → 세트 전체에서 1부터 이어지는 슬라이드 번호.
 * `positionOfSlideNumber`의 역함수다. 곡이 바뀌어도 번호는 1로 돌아가지 않는다.
 * 범위 밖 위치는 clamp한 뒤 계산한다. 그 위치에 슬라이드가 없으면(빈 세트,
 * 0장인 곡) 0.
 */
export function slideNumberOfPosition(
  position: ProjectionPosition,
  songs: Songs,
): number {
  const current = clampPosition(position, songs);
  if (slideCountOf(songs, current.songIndex) === 0) return 0;

  let before = 0;
  for (let songIndex = 0; songIndex < current.songIndex; songIndex++) {
    before += slideCountOf(songs, songIndex);
  }
  return before + current.slideIndex + 1;
}

export function getSlideAt(
  position: ProjectionPosition,
  songs: Songs,
): Slide | null {
  return songs[position.songIndex]?.deck?.slides[position.slideIndex] ?? null;
}

/**
 * 번호 점프로 들어온 인덱스를 그대로 쓰면 없는 곡·슬라이드를 가리켜 청중
 * 화면이 비어 버린다.
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
