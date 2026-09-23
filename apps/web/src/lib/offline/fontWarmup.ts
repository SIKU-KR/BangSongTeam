import { collectPresentationFonts, type Presentation } from "@repo/shared";

/**
 * 세트가 쓰는 글꼴을 미리 불러 런타임 캐시를 데운다.
 *
 * 번들 폰트 전체(Pretendard 9종 + Noto Sans KR 유니코드 서브셋 수백 개)는 33MB라
 * 프리캐시할 수 없다. 대신 Service Worker가 `worship-fonts-cache`로 실제 요청된
 * 서브셋만 담는데, 그 요청은 해당 글자가 화면에 그려질 때 발생한다. 준비 단계에서
 * 가사 글자를 직접 지정해 `document.fonts.load`를 부르면, 송출 때 쓸 서브셋이
 * 미리 캐시에 들어간다.
 */

/** 이 세트에서 실제로 쓰이는 글자들(중복 제거)을 뽑는다 */
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
  // jsdom·구형 환경에는 FontFaceSet이 없다. 폰트 워밍은 실패해도 송출을 막지 않는다.
  if (typeof document === "undefined" || !document.fonts?.load) return;

  const fonts = collectPresentationFonts(presentation);
  if (fonts.length === 0) return;

  const sample = sampleTextOf(presentation);
  if (!sample) return;

  await Promise.all(
    fonts.flatMap((fontFamily) =>
      // 400과 700 둘 다 데운다 — 가사는 굵기를 바꿔 쓰는 경우가 있다.
      ["400", "700"].map((weight) =>
        document.fonts
          .load(`${weight} 1rem "${fontFamily}"`, sample)
          .catch(() => undefined),
      ),
    ),
  );
}
