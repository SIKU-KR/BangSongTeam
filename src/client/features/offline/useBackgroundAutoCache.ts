import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  type BackgroundMedia,
  type Presentation,
} from "#shared";
import { scheduleMediaCaching, warmPresentationFonts } from "../../lib/offline";
import { useBackgroundCatalog } from "../backgrounds/backgroundCatalog";

export const AUTO_CACHE_DELAY_MS = 3000;

/**
 * 송출 중 세트의 나머지 배경을 받기 시작하기까지의 조용한 시간.
 * 곡을 바꿀 때마다 다시 센다. 방금 시작한 곡 영상이 버퍼를 채울 동안 대역폭을 비워 둔다.
 */
export const PROJECTION_BACKLOG_DELAY_MS = 30_000;

function useBackgroundLookup(): (id: string) => BackgroundMedia | undefined {
  const catalog = useBackgroundCatalog();
  return useMemo(() => {
    const byId = new Map(catalog.backgrounds.map((bg) => [bg.id, bg]));
    return (id: string) => byId.get(id);
  }, [catalog.backgrounds]);
}

function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * 열려 있는 세트의 배경 영상·포스터와 글꼴을 조용히 캐시에 담는다.
 *
 * 배경 URL은 로컬 배경 카탈로그에서 찾는다. 카탈로그가 바뀌면(방금 올린 커스텀
 * 배경을 곡에 지정, 동기화로 목록 갱신) 새로 생긴 URL도 곧바로 캐시 대상이 된다.
 */
export function useBackgroundAutoCache(
  presentation: Presentation | null,
): void {
  const findBackground = useBackgroundLookup();
  const urls = useMemo(
    () =>
      presentation
        ? collectUniqueMediaUrls(
            collectPresentationMediaAssets(presentation, findBackground),
          )
        : [],
    [presentation, findBackground],
  );
  const urlKey = urls.join("|");
  const presentationId = presentation?.id ?? null;

  const urlsRef = useLatest(urls);
  const presentationRef = useLatest(presentation);

  useEffect(() => {
    if (!presentationId) return;
    const timer = setTimeout(() => {
      scheduleMediaCaching(urlsRef.current);
      const current = presentationRef.current;
      if (current) void warmPresentationFonts(current).catch(() => undefined);
    }, AUTO_CACHE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [presentationId, urlKey]);

  useEffect(() => {
    const handleOnline = (): void => {
      scheduleMediaCaching(urlsRef.current);
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);
}

/**
 * 송출 화면의 배경 캐시. 캐시가 빈 채로 송출을 시작해도 재생 중인 영상과 대역폭을 덜 다투게 한다.
 *
 * 지금 곡과 다음 곡 배경은 곧바로 큐 맨 앞에 세운다. 세트의 나머지는 곡을 바꾼 뒤
 * `PROJECTION_BACKLOG_DELAY_MS` 동안 곡이 그대로일 때 받는다. 곡 순번은 송출 라우트와
 * 같게 `presentation.items`의 배열 순서를 따른다. 글꼴은 `usePresentationFontsReady`가 맡는다.
 */
export function useProjectionMediaCache(
  presentation: Presentation | null,
  songIndex: number,
): void {
  const findBackground = useBackgroundLookup();
  const { focusUrls, allUrls } = useMemo(() => {
    if (!presentation) return { focusUrls: [], allUrls: [] };
    const focusUrls = [songIndex, songIndex + 1].flatMap((index) => {
      const backgroundId = presentation.items[index]?.deck?.backgroundId;
      const background = backgroundId ? findBackground(backgroundId) : null;
      return background ? [background.mediaUrl, background.posterUrl] : [];
    });
    return {
      focusUrls: [...new Set(focusUrls)],
      allUrls: collectUniqueMediaUrls(
        collectPresentationMediaAssets(presentation, findBackground),
      ),
    };
  }, [presentation, findBackground, songIndex]);
  const focusKey = focusUrls.join("|");
  const allKey = allUrls.join("|");

  const focusUrlsRef = useLatest(focusUrls);
  const allUrlsRef = useLatest(allUrls);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    scheduleMediaCaching(focusUrlsRef.current, { priority: true });
  }, [focusKey, onlineCount]);

  useEffect(() => {
    if (!allKey) return;
    const timer = setTimeout(() => {
      scheduleMediaCaching(allUrlsRef.current);
    }, PROJECTION_BACKLOG_DELAY_MS);
    return () => clearTimeout(timer);
  }, [allKey, songIndex, onlineCount]);

  useEffect(() => {
    const handleOnline = (): void => setOnlineCount((count) => count + 1);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);
}
