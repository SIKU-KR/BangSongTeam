import { collectPresentationFonts, type Presentation } from "#shared";
import { loadWebFont } from "../fonts/fontLoader";

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

export async function warmPresentationFonts(
  presentation: Presentation,
): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;

  const fonts = collectPresentationFonts(presentation);
  if (fonts.length === 0) return;

  await Promise.all(fonts.map((fontFamily) => loadWebFont(fontFamily)));

  const sample = sampleTextOf(presentation);
  if (!sample) return;

  await Promise.all(
    fonts.flatMap((fontFamily) =>
      ["400", "700"].map((weight) =>
        document.fonts
          .load(`${weight} 1rem "${fontFamily}"`, sample)
          .catch(() => undefined),
      ),
    ),
  );
}
