import type { Presentation } from "../schemas/presentation";
import type { BackgroundMedia } from "../schemas/media";
import type { SupportedFont } from "../constants";

/**
 * 백그라운드 캐시가 내려받을 자산 목록 계산.
 *
 * 편집기나 송출 화면에 세트가 열려 있으면 앱이 그 세트의 배경 영상과 포스터를
 * 조용히 캐시에 담는다 (예배 준비 화면은 2026-09-24에 제거됐다). 무엇을 받을지는
 * 순수 계산이므로 브라우저 API에 의존하지 않고 여기서 결정하고, 실제 다운로드는
 * 앱 쪽 캐시 계층이 맡는다.
 */
export interface PresentationMediaAsset {
  /** 세트 내 곡 순번 (0-based) */
  songIndex: number;
  songTitle: string;
  backgroundId: string | null;
  /** 배경 카탈로그에서 찾은 제목. 못 찾으면 null */
  backgroundTitle: string | null;
  /** 배경 영상(또는 이미지) URL. 배경이 없거나 알 수 없는 id면 undefined */
  mediaUrl?: string;
  /** 포스터 이미지 URL */
  posterUrl?: string;
}

/**
 * 세트의 곡별 배경 자산을 곡 순서대로 돌려준다.
 *
 * 배경 메타데이터는 호출하는 쪽의 카탈로그(IndexedDB에 보관된 목록)에서 찾는다.
 * 카탈로그에 없는 id — 지워진 커스텀 배경, 아직 동기화되지 않은 배경 — 인 곡도
 * 곡 순번을 유지하려고 빠뜨리지 않는다. URL이 없으므로 다운로드 대상에서는 자연히 빠진다.
 */
export function collectPresentationMediaAssets(
  presentation: Presentation,
  findBackground: (backgroundId: string) => BackgroundMedia | undefined,
): PresentationMediaAsset[] {
  return presentation.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item, songIndex) => {
      const deck = item.deck;
      const backgroundId = deck?.backgroundId ?? null;
      const background = backgroundId
        ? findBackground(backgroundId)
        : undefined;

      return {
        songIndex,
        songTitle: deck?.title ?? "(제목 없음)",
        backgroundId,
        backgroundTitle: background?.title ?? null,
        mediaUrl: background?.mediaUrl,
        posterUrl: background?.posterUrl,
      };
    });
}

/**
 * 실제로 내려받을 URL 목록 (중복 제거).
 *
 * 5곡 세트에서 같은 루프를 여러 곡이 쓰는 것이 정상이다. 곡 수만큼 받으면
 * 같은 20MB 영상을 네 번 받는다. 이미지 배경은 영상과 포스터 URL이 같다.
 */
export function collectUniqueMediaUrls(
  assets: readonly PresentationMediaAsset[],
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const asset of assets) {
    for (const url of [asset.mediaUrl, asset.posterUrl]) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

/**
 * 세트가 쓰는 글꼴 목록 (중복 제거).
 *
 * 폰트는 프리캐시 대상이 아니라 런타임 캐시 대상이다(번들 폰트 전체가 33MB라
 * 프리캐시할 수 없다). 세트를 열었을 때 세트가 실제로 쓰는 글꼴만 불러 캐시를
 * 데워 두면 오프라인에서 글꼴이 깨지지 않는다.
 */
export function collectPresentationFonts(
  presentation: Presentation,
): SupportedFont[] {
  const fonts: SupportedFont[] = [];
  const seen = new Set<string>();

  for (const item of presentation.items) {
    const fontFamily = item.deck?.style.fontFamily;
    if (!fontFamily || seen.has(fontFamily)) continue;
    seen.add(fontFamily);
    fonts.push(fontFamily);
  }

  return fonts;
}
