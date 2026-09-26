import { useSyncExternalStore } from "react";
import {
  analyzeDeckOverflow,
  estimateTextWidth,
  type DeckOverflow,
  type DeckStyle,
  type Slide,
  type TextWidthMeasurer,
} from "#shared";
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

function createMeasurer(): TextWidthMeasurer {
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
}

let measurer: TextWidthMeasurer | null = null;
const listeners = new Set<() => void>();
let stopWatchingFonts: (() => void) | null = null;

function refreshMeasurer(): void {
  measurer = null;
  for (const listener of listeners) listener();
}

function watchFontLoading(): () => void {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts?.addEventListener) return () => undefined;

  let cancelled = false;
  const bump = () => {
    if (!cancelled) refreshMeasurer();
  };
  fonts.ready.then(bump).catch(() => undefined);
  fonts.addEventListener("loadingdone", bump);
  return () => {
    cancelled = true;
    fonts.removeEventListener("loadingdone", bump);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stopWatchingFonts = watchFontLoading();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopWatchingFonts?.();
    stopWatchingFonts = null;
  };
}

function getMeasurer(): TextWidthMeasurer {
  measurer ??= createMeasurer();
  return measurer;
}

/**
 * 스테이지와 같은 번들 폰트로 줄 폭을 재는 측정기. 편집기 화면 전체가 캔버스와
 * 측정 캐시 하나를 같이 쓴다.
 *
 * 웹폰트가 늦게 도착하면 대체 폰트로 잰 값이 남으므로, 폰트 로딩이 끝날 때마다
 * 측정기를 새로 만들어 넘침 경고를 다시 계산하게 한다. 글꼴은 `unicode-range` 서브셋으로
 * 나뉘어 화면에 그린 글자의 서브셋만 받아지므로, 아직 그리지 않은 슬라이드의 글자는
 * 측정기가 직접 `document.fonts.load`로 받게 한다. 캔버스를 쓸 수 없는 환경에서는
 * 글자 폭 어림값으로 대신한다.
 */
export function useTextWidthMeasurer(): TextWidthMeasurer {
  return useSyncExternalStore(subscribe, getMeasurer, getMeasurer);
}

const overflowCache = new WeakMap<
  TextWidthMeasurer,
  WeakMap<Slide[], { style: DeckStyle; overflow: DeckOverflow }>
>();

/**
 * 곡 하나의 넘침 분석을 `slides`·`style` 참조 기준으로 캐시한다.
 *
 * 프레젠테이션 스토어는 바뀌지 않은 곡의 `slides`·`style` 참조를 그대로 두므로,
 * 가사를 한 글자 고치면 그 곡만 다시 분석하고 나머지 곡은 이전 결과 객체를 돌려준다.
 * 측정기가 바뀌면(폰트 로딩) 모든 곡을 다시 분석한다.
 */
export function analyzeDeckOverflowCached(
  deck: { slides: Slide[]; style: DeckStyle },
  measure: TextWidthMeasurer,
): DeckOverflow {
  let bySlides = overflowCache.get(measure);
  if (!bySlides) {
    bySlides = new WeakMap();
    overflowCache.set(measure, bySlides);
  }
  const cached = bySlides.get(deck.slides);
  if (cached && cached.style === deck.style) return cached.overflow;

  const overflow = analyzeDeckOverflow(deck.slides, deck.style, measure);
  bySlides.set(deck.slides, { style: deck.style, overflow });
  return overflow;
}
