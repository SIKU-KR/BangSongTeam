import type { Slide } from "../schemas/slide";
import { sanitizeLyricLine } from "./lyrics";

/**
 * 공개 검색 카드의 첫 슬라이드 미리보기 (PRD 4.7, TECH_SPEC §8.1).
 *
 * 로그인 없이 열리는 공개 검색은 가사 전문을 담지 않는다. 배열 순서가 아니라
 * `order`가 가장 앞선 슬라이드를 쓴다 — 편집 중 정렬이 어긋난 저장본도 있다.
 */
export function firstSlidePreview(slides: Slide[]): string[] {
  if (slides.length === 0) return [];
  const first = slides.reduce((min, slide) =>
    slide.order < min.order ? slide : min,
  );
  return [...first.lines];
}

/**
 * 가사 라이브러리 검색 결과의 첫 2줄 미리보기 (PRD 4.8 노출 범위).
 * 빈 줄과 앞뒤 공백은 건너뛴다.
 */
export function twoLinesPreview(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(sanitizeLyricLine)
    .filter((line) => line.length > 0)
    .slice(0, 2);
}
