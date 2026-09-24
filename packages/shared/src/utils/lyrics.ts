import { Slide, SlideSchema } from "../schemas/slide";

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
    if (block.length <= 4) {
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
