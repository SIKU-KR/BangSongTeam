import { useEffect, useState } from "react";
import { findCachedMediaUrls } from "../../lib/offline/mediaCache";

/**
 * 이 미디어가 기기 캐시에 담겨 있는지. 담겨 있으면 송출 전에 받지 않아도 되고
 * 오프라인에서도 재생된다.
 *
 * 마운트할 때와 URL이 바뀔 때 한 번만 확인한다. 받는 중인 파일은 다시 열 때 반영된다.
 */
export function useIsMediaCached(url: string): boolean {
  const [cachedUrl, setCachedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    findCachedMediaUrls([url])
      .then((cached) => {
        if (!cancelled && cached.includes(url)) setCachedUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  return cachedUrl === url;
}
