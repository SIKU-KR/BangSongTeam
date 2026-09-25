import { MAX_SLIDE_LINES, Slide, SlideSchema } from "../schemas/slide";

/**
 * 앞뒤 일반 공백 및 전각 공백(\u3000), 특수 공백(\u00A0, \uFEFF 등)을 제거한다.
 */
export function sanitizeLyricLine(line: string): string {
  return line.replace(
    /^[\s\u00A0\u3000\u200B\uFEFF]+|[\s\u00A0\u3000\u200B\uFEFF]+$/g,
    "",
  );
}

/**
 * 가사 원본 텍스트를 슬라이드 목록으로 분할한다.
 * 최대 4줄까지 단일 슬라이드를 유지하고, 4줄 초과 블록은 2줄 단위로 분할한다.
 */
export function splitLyricsIntoSlides(rawText: string): Slide[] {
  const rawLines = rawText.split(/\r?\n/);
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const rawLine of rawLines) {
    const cleaned = sanitizeLyricLine(rawLine);
    if (cleaned.length === 0) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
    } else {
      currentBlock.push(cleaned);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  const slides: Slide[] = [];
  let order = 0;

  for (const block of blocks) {
    if (block.length <= MAX_SLIDE_LINES) {
      slides.push(
        SlideSchema.parse({
          order: order++,
          lines: block,
        }),
      );
    } else {
      for (let i = 0; i < block.length; i += 2) {
        const chunk = block.slice(i, i + 2);
        slides.push(
          SlideSchema.parse({
            order: order++,
            lines: chunk,
          }),
        );
      }
    }
  }

  return slides;
}

/**
 * 슬라이드 목록을 순서대로 정렬하여 빈 줄(\n\n)로 구분된 가사 원문 문자열로 역변환한다.
 */
export function mergeSlidesToLyrics(slides: Slide[]): string {
  if (slides.length === 0) return "";
  const sorted = [...slides].sort((a, b) => a.order - b.order);
  return sorted.map((slide) => slide.lines.join("\n")).join("\n\n");
}

function isBlankLine(line: string): boolean {
  return sanitizeLyricLine(line).length === 0;
}

/**
 * 가사 편집창의 커서 위치에서 슬라이드 줄 목록을 앞뒤 둘로 나눈다.
 *
 * `offset`은 `lines.join("\n")` 기준 문자 위치다. 커서가 줄 중간이면 그 줄을
 * 쪼개고, 나눈 자리에 생긴 앞뒤 공백과 빈 줄은 버린다. 어느 한쪽에 가사가
 * 남지 않으면 나눌 수 없으므로 `null`을 돌려준다.
 */
export function splitLinesAtCursor(
  lines: readonly string[],
  offset: number,
): [string[], string[]] | null {
  const text = lines.join("\n");
  const before = text.slice(0, Math.max(0, offset)).split("\n");
  const after = text.slice(Math.max(0, offset)).split("\n");

  before[before.length - 1] = sanitizeLyricLine(before[before.length - 1]);
  after[0] = sanitizeLyricLine(after[0]);

  while (before.length > 0 && isBlankLine(before[before.length - 1])) {
    before.pop();
  }
  while (after.length > 0 && isBlankLine(after[0])) {
    after.shift();
  }

  if (before.length === 0 || after.length === 0) return null;
  return [before, after];
}

/**
 * 두 슬라이드의 줄을 이어 붙인 결과를 돌려준다. 합친 줄 수가 슬라이드 최대 줄
 * 수를 넘으면 합칠 수 없으므로 `null`이다.
 */
export function mergeSlideLines(
  first: readonly string[],
  second: readonly string[],
): string[] | null {
  const merged = [...first, ...second];
  return merged.length <= MAX_SLIDE_LINES ? merged : null;
}
