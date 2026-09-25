import { collectPresentationFonts, type Presentation } from "#shared";
import { loadWebFont, toCssFontFamily } from "../fonts/fontLoader";

function sampleTextOf(presentation: Presentation): string {
  const chars = new Set<string>();
  for (const item of presentation.items) {
    for (const slide of item.deck?.slides ?? []) {
      for (const line of slide.lines) {
        for (const char of line) {
          if (char.trim()) chars.add(char);
        }
      }
    }
  }
  return [...chars].join("");
}

/**
 * 세트 가사에 쓰인 글자로 글꼴 서브셋을 미리 받아 SW 글꼴 캐시에 담는다.
 * 번들 가사 글꼴은 CSS 청크가 붙어야 `@font-face`가 생기므로 그 로드를 먼저 기다린다.
 */
export async function warmPresentationFonts(
  presentation: Presentation,
): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;

  const fonts = collectPresentationFonts(presentation);
  if (fonts.length === 0) return;

  await Promise.all(fonts.map(loadWebFont));

  const sample = sampleTextOf(presentation);
  if (!sample) return;

  await Promise.all(
    fonts.flatMap((fontFamily) =>
      ["400", "700"].map((weight) =>
        document.fonts
          .load(`${weight} 1rem ${toCssFontFamily(fontFamily)}`, sample)
          .catch(() => undefined),
      ),
    ),
  );
}
