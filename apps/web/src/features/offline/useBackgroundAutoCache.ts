import { useEffect, useMemo, useRef } from "react";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  type Presentation,
} from "@repo/shared";
import { scheduleMediaCaching, warmPresentationFonts } from "../../lib/offline";

export const AUTO_CACHE_DELAY_MS = 3000;

/**
 * 열려 있는 세트의 배경 영상·포스터와 글꼴을 조용히 캐시에 담는다.
 */
export function useBackgroundAutoCache(
  presentation: Presentation | null,
): void {
  const urls = useMemo(
    () =>
      presentation
        ? collectUniqueMediaUrls(collectPresentationMediaAssets(presentation))
        : [],
    [presentation],
  );
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

