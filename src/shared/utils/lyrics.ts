import {
  MAX_SLIDE_LINE_LENGTH,
  MAX_SLIDE_LINES,
  Slide,
  SlideSchema,
} from "../schemas/slide";

/**
 * 앞뒤 일반 공백 및 전각 공백(\u3000), 특수 공백(\u00A0, \uFEFF 등)을 제거한다.
 */
export function sanitizeLyricLine(line: string): string {
  return line.replace(
    /^[\s\u00A0\u3000\u200B\uFEFF]+|[\s\u00A0\u3000\u200B\uFEFF]+$/g,
    "",
  );
}

function wrapLyricLine(line: string): string[] {
  if (line.length <= MAX_SLIDE_LINE_LENGTH) return [line];

  const text = sanitizeLyricLine(line);
  if (text.length <= MAX_SLIDE_LINE_LENGTH) return [text];

  const ideal = text.length / Math.ceil(text.length / MAX_SLIDE_LINE_LENGTH);
  let space = -1;
  for (let i = 1; i <= MAX_SLIDE_LINE_LENGTH; i++) {
    if (
      /\s/.test(text[i]) &&
      (space < 0 || Math.abs(i - ideal) < Math.abs(space - ideal))
    ) {
      space = i;
    }
  }
  const cut = space < 0 ? MAX_SLIDE_LINE_LENGTH : space;

  return [
    sanitizeLyricLine(text.slice(0, cut)),
    ...wrapLyricLine(sanitizeLyricLine(text.slice(cut))),
  ];
}

/**
 * 줄 목록을 슬라이드 한 장의 제한에 맞는 묶음으로 나눈다. `MAX_SLIDE_LINE_LENGTH`를
 * 넘는 줄은 조각 길이가 고르도록 공백에서 끊어 여러 줄로 만든다(공백이 없으면
 * 글자 수로 자른다). 그 결과가 `MAX_SLIDE_LINES`를 넘으면 2줄씩 나누되, 한 줄에서
 * 나온 조각은 되도록 같은 슬라이드에 둔다.
 */
export function fitLinesToSlides(lines: readonly string[]): string[][] {
  const units = lines.map(wrapLyricLine);
  const wrapped = units.flat();
  if (wrapped.length <= MAX_SLIDE_LINES) return [wrapped];

  const chunks: string[][] = [];
  let current: string[] = [];
  for (const unit of units) {
    if (current.length > 0 && current.length + unit.length > 2) {
      chunks.push(current);
      current = [];
    }
    for (const piece of unit) {
      if (current.length === 2) {
        chunks.push(current);
        current = [];
      }
      current.push(piece);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 저장된 슬라이드를 `SlideSchema` 제한에 맞게 나눈다.
 *
 * 제한을 넘는 가사(찬송가는 한 절이 한 줄이라 80자를 넘기 쉽다)가 이미 DB에
 * 있어도 버리지 않고 여러 장으로 읽기 위한 것이다. 나뉜 뒷장은 원래 id에
 * `_2`, `_3`…을 붙여 몇 번을 읽어도 같은 id가 나오고, `order`는 0부터 다시 매긴다.
 */
export function fitSlidesToLimits(
  slides: ReadonlyArray<{
    id: string;
    order: number;
    lines: readonly string[];
  }>,
): Slide[] {
  return [...slides]
    .sort((a, b) => a.order - b.order)
    .flatMap((slide) =>
      fitLinesToSlides(slide.lines).map((lines, index) => ({
        id: index === 0 ? slide.id : `${slide.id}_${index + 1}`,
        lines,
      })),
    )
    .map((slide, order) => ({ ...slide, order }));
}

/**
 * 가사 원본 텍스트를 슬라이드 목록으로 분할한다. 빈 줄로 나뉜 블록마다
 * `fitLinesToSlides` 규칙으로 슬라이드를 만든다.
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

  return blocks
    .flatMap(fitLinesToSlides)
    .map((lines, order) => SlideSchema.parse({ order, lines }));
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
