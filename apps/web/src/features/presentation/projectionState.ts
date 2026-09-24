import type { PresentationItem, Slide } from "@repo/shared";

/**
 * 송출 위치 계산 (순수 함수).
 *
 * 라우트 안에 두면 키보드 이동·번호 점프가 각자 경계 규칙을 갖게 된다.
 * 한곳에 모아 곡 경계·세트 끝 처리를 한 벌로 유지하고 단위 테스트로 고정한다.
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
