import type {
  AnchoredPosition,
  PresentationItem,
  ProjectionPosition,
  Slide,
} from "#shared";

export type { AnchoredPosition, ProjectionPosition };

export const INITIAL_POSITION: ProjectionPosition = {
  songIndex: 0,
  slideIndex: 0,
};

type Songs = readonly PresentationItem[];

/** 곡의 슬라이드. 범위 밖 인덱스이거나 덱이 붙지 않은 항목이면 빈 배열 */
export function songSlidesAt(songs: Songs, songIndex: number): Slide[] {
  return songs[songIndex]?.deck?.slides ?? [];
}

function slideCountOf(songs: Songs, songIndex: number): number {
  return songSlidesAt(songs, songIndex).length;
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
  return songSlidesAt(songs, position.songIndex)[position.slideIndex] ?? null;
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

/**
 * 곡 순서를 `from`에서 `to`로 옮긴 뒤 보고 있던 곡의 새 인덱스.
 * 옮긴 곡이 보고 있던 곡이면 따라가고, 앞뒤로 끼어든 곡만큼 한 칸 밀리거나 당겨진다.
 */
export function songIndexAfterReorder(
  activeSongIndex: number,
  from: number,
  to: number,
): number {
  if (activeSongIndex === from) return to;
  if (from < activeSongIndex && to >= activeSongIndex) {
    return activeSongIndex - 1;
  }
  if (from > activeSongIndex && to <= activeSongIndex) {
    return activeSongIndex + 1;
  }
  return activeSongIndex;
}

/** 위치를 그 자리 곡의 id에 고정한다. 범위 밖 위치는 clamp한 자리의 곡에 고정한다 */
export function anchorPosition(
  position: ProjectionPosition,
  songs: Songs,
): AnchoredPosition {
  const current = clampPosition(position, songs);
  return { ...current, itemId: songs[current.songIndex]?.id ?? null };
}

/**
 * 고정한 곡을 지금 프레젠테이션에서 다시 찾아 위치를 정한다. 곡이 사라졌으면 원래 인덱스를,
 * 슬라이드가 줄었으면 남은 마지막 슬라이드를 쓴다 (clamp).
 */
export function resolveAnchoredPosition(
  anchored: AnchoredPosition,
  songs: Songs,
): ProjectionPosition {
  const songIndex =
    anchored.itemId === null
      ? -1
      : songs.findIndex((item) => item.id === anchored.itemId);
  return clampPosition(
    songIndex === -1
      ? anchored
      : { songIndex, slideIndex: anchored.slideIndex },
    songs,
  );
}
