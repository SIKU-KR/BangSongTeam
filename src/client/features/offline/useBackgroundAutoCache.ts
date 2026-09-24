import { useEffect, useMemo, useRef } from "react";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  type Presentation,
} from "#shared";
import { scheduleMediaCaching, warmPresentationFonts } from "../../lib/offline";
import { useBackgroundCatalog } from "../backgrounds/backgroundCatalog";

export const AUTO_CACHE_DELAY_MS = 3000;

/**
 * 열려 있는 세트의 배경 영상·포스터와 글꼴을 조용히 캐시에 담는다.
 *
 * 배경 URL은 로컬 배경 카탈로그에서 찾는다. 카탈로그가 바뀌면(방금 올린 커스텀
 * 배경을 곡에 지정, 동기화로 목록 갱신) 새로 생긴 URL도 곧바로 캐시 대상이 된다.
 */
export function useBackgroundAutoCache(
  presentation: Presentation | null,
): void {
  const catalog = useBackgroundCatalog();
  const urls = useMemo(() => {
    if (!presentation) return [];
    const byId = new Map(catalog.backgrounds.map((bg) => [bg.id, bg]));
    return collectUniqueMediaUrls(
      collectPresentationMediaAssets(presentation, (id) => byId.get(id)),
    );
  }, [presentation, catalog.backgrounds]);
  const urlKey = urls.join("|");
  const presentationId = presentation?.id ?? null;

  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

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
