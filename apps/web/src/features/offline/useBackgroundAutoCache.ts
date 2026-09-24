import { useEffect, useMemo, useRef } from "react";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  type Presentation,
} from "@repo/shared";
import { scheduleMediaCaching, warmPresentationFonts } from "../../lib/offline";

/**
 * 열려 있는 세트의 배경 영상·포스터와 글꼴을 조용히 캐시에 담는다.
 *
 * 예배 준비 화면(송출 전 미리받기)을 대신한다 (2026-09-24). 편집기와 송출 화면이
 * 이 훅을 부르므로, 세트를 편집하거나 송출하는 동안 온라인이면 필요한 파일이
 * 알아서 쌓인다. UI는 없다. 실패해도 알리지 않고 다음 기회에 다시 받는다.
 */

/**
 * 세트가 열리거나 배경이 바뀐 뒤 받기 시작할 때까지의 지연.
 *
 * 편집기에서 배경을 이것저것 눌러 볼 때마다 20MB씩 받지 않도록 하고, 송출 직후에는
 * 화면에 나오는 영상이 먼저 대역폭을 쓰게 한다.
 */
export const AUTO_CACHE_DELAY_MS = 3000;

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
  // 이펙트 의존성으로 쓰기 위한 안정적인 키. 가사를 고칠 때마다 문서 identity는
  // 바뀌지만 받을 파일 집합은 그대로다.
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

  // 네트워크가 돌아오면 받다 만 것을 이어 받는다.
  useEffect(() => {
    const handleOnline = (): void => {
      scheduleMediaCaching(urlsRef.current);
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);
}
