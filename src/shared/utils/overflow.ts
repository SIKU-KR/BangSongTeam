import type { Slide } from "../schemas/slide";
import type { DeckStyle, GridAnchorPreset } from "../schemas/style";

const STAGE_WIDTH_PX = 1920;
const STAGE_HEIGHT_PX = 1080;
const STAGE_SAFE_MARGIN_PERCENT = 5;
const LAYOUT_TOLERANCE_PX = 0.5;

/**
 * 한 줄 텍스트가 스테이지(1920px 기준)에서 차지하는 폭을 px로 돌려준다.
 * 브라우저에서는 실제 폰트로 재는 구현을, 그 밖에서는 `estimateTextWidth`를 쓴다.
 */
export type TextWidthMeasurer = (
  text: string,
  fontSizePx: number,
  fontFamily: string,
) => number;

export interface SlideOverflow {
  /** 한 줄 이상이 텍스트 박스 폭을 넘어 자동 줄바꿈된다 */
  wraps: boolean;
  /** 자동 줄바꿈까지 반영해 화면에 그려지는 줄 수 */
  visualLineCount: number;
}

export interface DeckOverflow {
  slides: SlideOverflow[];
  /** 화면에 그려지는 줄 수가 가장 많은 슬라이드. 슬라이드가 없으면 null */
  tallestSlideIndex: number | null;
  /** 가장 긴 슬라이드의 텍스트 박스가 화면 안전 여백(가장자리 5%)을 벗어난다 */
  exceedsStage: boolean;
}

function charWidthEm(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3000 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff00 && code <= 0xffef)
  ) {
    return 0.95;
  }
  if (char === " ") return 0.28;
  if (/[A-Z0-9]/.test(char)) return 0.62;
  if (/[a-z]/.test(char)) return 0.52;
  if (code < 0x80) return 0.35;
  return 0.6;
}

/**
 * 폰트 없이 글자 종류별 평균 폭(em)으로 줄 폭을 어림한다.
 * 한글·한자·전각 문자는 영문 소문자의 약 1.8배로 잡는다.
 */
export function estimateTextWidth(text: string, fontSizePx: number): number {
  let em = 0;
  for (const char of text) em += charWidthEm(char);
  return em * fontSizePx;
}

const defaultMeasurer: TextWidthMeasurer = (text, fontSizePx) =>
  estimateTextWidth(text, fontSizePx);

/**
 * 스테이지의 `white-space: pre-wrap; word-break: keep-all`과 같게 공백에서만
 * 줄을 바꾼다고 보고, 한 줄이 화면에서 몇 줄로 그려지는지 센다.
 */
function countWrappedLines(line: string, fits: (text: string) => boolean) {
  if (line === "") return 0;

  const words = line.split(" ");
  let count = 1;
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (fits(candidate)) {
      current = candidate;
    } else {
      count += 1;
      current = word;
    }
  }
  return count;
}

function boxTopPx(anchor: GridAnchorPreset, yPx: number, heightPx: number) {
  if (anchor.startsWith("top-")) return yPx;
  if (anchor.startsWith("bottom-")) return yPx - heightPx;
  return yPx - heightPx / 2;
}

/**
 * 곡의 텍스트 넘침을 계산한다 (PRD 4.2·4.4).
 *
 * - 슬라이드 경고: 한 줄이 텍스트 박스 폭을 넘어 자동 줄바꿈되는 경우
 * - 곡 경고: 줄바꿈까지 반영해 가장 긴 슬라이드의 박스가 화면 안전 여백을 벗어나는 경우.
 *   박스는 기준점에서 자라므로 상단 배치는 아래로, 하단 배치는 위로 커진다.
 */
export function analyzeDeckOverflow(
  slides: Slide[],
  style: DeckStyle,
  measure: TextWidthMeasurer = defaultMeasurer,
): DeckOverflow {
  const fontSizePx = (style.fontSizeVw * STAGE_WIDTH_PX) / 100;
  const boxWidthPx = (style.position.widthPercent * STAGE_WIDTH_PX) / 100;
  const fits = (text: string) =>
    measure(text, fontSizePx, style.fontFamily) <=
    boxWidthPx + LAYOUT_TOLERANCE_PX;

  const results = slides.map((slide): SlideOverflow => {
    let wraps = false;
    let visualLineCount = 0;
    for (const line of slide.lines) {
      if (line !== "" && !fits(line)) wraps = true;
      visualLineCount += countWrappedLines(line, fits);
    }
    return { wraps, visualLineCount };
  });

  let tallestSlideIndex: number | null = null;
  for (let index = 0; index < results.length; index += 1) {
    if (
      tallestSlideIndex === null ||
      results[index].visualLineCount >
        results[tallestSlideIndex].visualLineCount
    ) {
      tallestSlideIndex = index;
    }
  }

  let exceedsStage = false;
  if (tallestSlideIndex !== null) {
    const heightPx =
      results[tallestSlideIndex].visualLineCount *
      fontSizePx *
      style.lineHeight;
    const topPx = boxTopPx(
      style.position.anchor,
      (style.position.yPercent * STAGE_HEIGHT_PX) / 100,
      heightPx,
    );
    const safeMarginPx = (STAGE_SAFE_MARGIN_PERCENT * STAGE_HEIGHT_PX) / 100;
    exceedsStage =
      topPx < safeMarginPx - LAYOUT_TOLERANCE_PX ||
      topPx + heightPx > STAGE_HEIGHT_PX - safeMarginPx + LAYOUT_TOLERANCE_PX;
  }

  return { slides: results, tallestSlideIndex, exceedsStage };
}
