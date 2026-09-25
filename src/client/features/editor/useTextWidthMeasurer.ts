import { useEffect, useMemo, useState } from "react";
import { estimateTextWidth, type TextWidthMeasurer } from "#shared";
import { toCssFontFamily } from "../../lib/fonts/fontLoader";

function createCanvasContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  try {
    return document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
}

function requestMissingGlyphs(font: string, text: string): void {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts?.check || !fonts.load) return;
  try {
    if (fonts.check(font, text)) return;
  } catch {
    return;
  }
  fonts.load(font, text).catch(() => undefined);
}

/**
 * 스테이지와 같은 번들 폰트로 줄 폭을 재는 측정기.
 *
 * 웹폰트가 늦게 도착하면 대체 폰트로 잰 값이 남으므로, 폰트 로딩이 끝날 때마다
 * 측정기를 새로 만들어 넘침 경고를 다시 계산하게 한다. 글꼴은 `unicode-range` 서브셋으로
 * 나뉘어 화면에 그린 글자의 서브셋만 받아지므로, 아직 그리지 않은 슬라이드의 글자는
 * 측정기가 직접 `document.fonts.load`로 받게 한다. 캔버스를 쓸 수 없는 환경에서는
 * 글자 폭 어림값으로 대신한다.
 */
export function useTextWidthMeasurer(): TextWidthMeasurer {
  const [fontsVersion, setFontsVersion] = useState(0);

  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts?.addEventListener) return;

    let cancelled = false;
    const bump = () => {
      if (!cancelled) setFontsVersion((version) => version + 1);
    };
    fonts.ready.then(bump).catch(() => undefined);
    fonts.addEventListener("loadingdone", bump);
    return () => {
      cancelled = true;
      fonts.removeEventListener("loadingdone", bump);
    };
  }, []);

  return useMemo(() => {
    const context = createCanvasContext();
    if (!context) {
      return (text, fontSizePx) => estimateTextWidth(text, fontSizePx);
    }

    const cache = new Map<string, number>();
    return (text, fontSizePx, fontFamily) => {
      const key = `${fontSizePx}|${fontFamily}|${text}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const font = `${fontSizePx}px ${toCssFontFamily(fontFamily)}`;
      requestMissingGlyphs(font, text);
      context.font = font;
      const width = context.measureText(text).width;
      cache.set(key, width);
      return width;
    };
  }, [fontsVersion]);
}
