import type { DeckStyle } from "#shared";

/**
 * PowerPoint 16:9 슬라이드는 가로 960pt라 1920px 스테이지에서 1pt = 2px이다.
 * `fontSizeVw`(스테이지 폭의 %)를 pt로 보이면 PowerPoint와 같은 숫자 감각이 된다.
 */
const PT_PER_VW = 9.6;
const MIN_FONT_SIZE_VW = 2;
const MAX_FONT_SIZE_VW = 10;

/** 글자 크기 목록 (pt). `DeckStyleSchema.fontSizeVw` 범위(2–10vw) 안이다 */
export const FONT_SIZE_PT_PRESETS: readonly number[] = [
  20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96,
];

export function vwToPt(vw: number): number {
  return Math.round(vw * PT_PER_VW);
}

/** pt를 스키마 범위 안의 vw로 바꾼다 (소수 둘째 자리) */
export function ptToVw(pt: number): number {
  const vw = Math.round((pt / PT_PER_VW) * 100) / 100;
  return Math.min(MAX_FONT_SIZE_VW, Math.max(MIN_FONT_SIZE_VW, vw));
}

/** 화면에 보이는 pt 기준으로 글자 크기 목록의 다음(1)·이전(-1) 칸. 목록 끝이면 그대로 둔다 */
export function stepFontSize(vw: number, direction: 1 | -1): number {
  const pt = vwToPt(vw);
  const next =
    direction === 1
      ? FONT_SIZE_PT_PRESETS.find((size) => size > pt)
      : [...FONT_SIZE_PT_PRESETS].reverse().find((size) => size < pt);
  return next === undefined ? vw : ptToVw(next);
}

/** 줄 간격 목록. 기본값은 1.4 */
export const LINE_HEIGHT_OPTIONS: readonly number[] = [
  1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.5,
];

export const SHADOW_LEVELS: ReadonlyArray<{
  id: DeckStyle["textShadowLevel"];
  label: string;
}> = [
  { id: "none", label: "없음" },
  { id: "soft", label: "은은함" },
  { id: "medium", label: "보통" },
  { id: "strong", label: "강함" },
];

export const PRESET_COLORS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "화이트", value: "#FFFFFF" },
  { label: "옐로우", value: "#FEF08A" },
  { label: "스카이", value: "#BAE6FD" },
  { label: "민트", value: "#A7F3D0" },
  { label: "핑크", value: "#FBCFE8" },
  { label: "그레이", value: "#D4D4D8" },
  { label: "블랙", value: "#000000" },
];

export const TEXT_ALIGN_OPTIONS: ReadonlyArray<{
  id: DeckStyle["textAlign"];
  label: string;
}> = [
  { id: "left", label: "왼쪽 맞춤" },
  { id: "center", label: "가운데 맞춤" },
  { id: "right", label: "오른쪽 맞춤" },
];
