import { collectPresentationFonts, type Presentation } from "#shared";
import { loadWebFont, toCssFontFamily } from "../fonts/fontLoader";
import { documentFonts } from "../browser/optionalApis";

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
 * 프레젠테이션 가사에 쓰인 글자로 글꼴 서브셋을 미리 받아 SW 글꼴 캐시에 담는다.
 * 번들 글꼴은 자체 오리진 글꼴 캐시에, 눈누 카탈로그 글꼴은 CDN 글꼴 캐시
 * (`CDN_FONT_CACHE_NAME`)에 담겨 오프라인 송출에서도 같은 글꼴로 그린다.
 * 번들 가사 글꼴의 CSS 청크나 카탈로그 글꼴의 스타일시트가 붙어야 `@font-face`가 생기므로
 * 그 로드를 먼저 기다리되, 글꼴마다 따로 기다린다. 인터넷이 안 되는 Wi-Fi에서는 CDN
 * 스타일시트 하나가 수십 초 뒤에야 실패하는데, 모두 함께 기다리면 그동안 번들 글꼴까지
 * 받지 못해 송출 첫 슬라이드가 대체 글꼴로 나온다.
 */
export async function warmPresentationFonts(
  presentation: Presentation,
): Promise<void> {
  const fontSet = documentFonts();
  if (!fontSet) return;

  const fonts = collectPresentationFonts(presentation);
  if (fonts.length === 0) return;

  const sample = sampleTextOf(presentation);

  await Promise.all(
    fonts.map(async (fontFamily) => {
      await loadWebFont(fontFamily);
      if (!sample) return;
      await Promise.all(
        ["400", "700"].map((weight) =>
          fontSet
            .load(`${weight} 1rem ${toCssFontFamily(fontFamily)}`, sample)
            .catch(() => undefined),
        ),
      );
    }),
  );
}
