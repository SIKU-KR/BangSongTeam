import type { DeckStyle, NoonnuFont } from "#shared";
import { DEFAULT_PRESET_FONTS } from "#shared";
import { EDITOR_COPY } from "#copy/editor";

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
  { id: "none", label: EDITOR_COPY.ribbon.shadowLevels.none },
  { id: "soft", label: EDITOR_COPY.ribbon.shadowLevels.soft },
  { id: "medium", label: EDITOR_COPY.ribbon.shadowLevels.medium },
  { id: "strong", label: EDITOR_COPY.ribbon.shadowLevels.strong },
];

export const TEXT_ALIGN_OPTIONS: ReadonlyArray<{
  id: DeckStyle["textAlign"];
  label: string;
}> = [
  { id: "left", label: EDITOR_COPY.ribbon.alignOptions.left },
  { id: "center", label: EDITOR_COPY.ribbon.alignOptions.center },
  { id: "right", label: EDITOR_COPY.ribbon.alignOptions.right },
];

/** 글꼴 목록을 처음에 보여 주고 '더 보기'로 늘리는 개수 */
export const FONT_LIST_PAGE_SIZE = 60;

/** 글꼴 검색 결과 최대 개수. 한 번에 수백 개의 미리보기 이미지를 받지 않게 자른다 */
export const FONT_SEARCH_RESULT_LIMIT = 60;

/**
 * 이름·제작자·카드 패밀리명에 검색어가 들어 있는 글꼴을 대소문자 구분 없이 찾는다.
 * 기본 글꼴도 카탈로그에 있어 검색 결과에 함께 나온다.
 */
export function searchFonts(
  catalog: readonly NoonnuFont[],
  query: string,
  limit: number,
): NoonnuFont[] {
  const needle = query.trim().toLowerCase();
  return catalog
    .filter(
      (f) =>
        f.name.toLowerCase().includes(needle) ||
        f.author.toLowerCase().includes(needle) ||
        f.cardFamily.toLowerCase().includes(needle),
    )
    .slice(0, limit);
}

/** 기본 글꼴은 목록 위 '기본 글꼴' 묶음에 따로 보여서 추가 글꼴 목록에서는 뺀다 */
export function excludePresetFonts(
  catalog: readonly NoonnuFont[],
): NoonnuFont[] {
  const presetSet = new Set<string>(DEFAULT_PRESET_FONTS);
  return catalog.filter((f) => !presetSet.has(f.name));
}
