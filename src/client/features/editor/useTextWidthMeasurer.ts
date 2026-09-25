import { useEffect, useMemo, useState } from "react";
import { estimateTextWidth, type TextWidthMeasurer } from "#shared";

function createCanvasContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  try {
    return document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
}

/**
 * 스테이지와 같은 번들 폰트로 줄 폭을 재는 측정기.
 *
 * 웹폰트가 늦게 도착하면 대체 폰트로 잰 값이 남으므로, 폰트 로딩이 끝날 때마다
 * 측정기를 새로 만들어 넘침 경고를 다시 계산하게 한다. 캔버스를 쓸 수 없는 환경에서는
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

      context.font = `${fontSizePx}px "${fontFamily}"`;
      const width = context.measureText(text).width;
      cache.set(key, width);
      return width;
    };
  }, [fontsVersion]);
}
