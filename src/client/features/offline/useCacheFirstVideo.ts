import { useEffect, useState } from "react";
import { cacheMediaFirst, shouldWaitForMediaCache } from "../../lib/offline";
import type { BackgroundLayers } from "../backgrounds/backgroundCatalog";

/**
 * 편집기 배경 영상을 캐시에 다 담은 뒤에 재생한다. 그동안은 포스터를 정지 이미지로 그린다.
 *
 * 곧바로 `<video>`를 붙이면 영상은 Range(206)로 스트리밍되어 캐시에 남지 않고,
 * 백그라운드 캐시가 같은 파일을 처음부터 다시 받는다. 느린 네트워크에서는 둘이 대역폭을
 * 나눠 쓴다. 캐시를 먼저 채우면 SW가 캐시본을 잘라 재생하므로 전체 다운로드가 한 번이다.
 * 캐시에 실패하면 그냥 스트리밍한다. 송출 화면은 배경이 늦게 뜨면 안 되므로 쓰지 않는다.
 */
export function useCacheFirstVideo(layers: BackgroundLayers): BackgroundLayers {
  const { videoUrl, posterUrl } = layers;
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const waiting =
    !!videoUrl && videoUrl !== readyUrl && shouldWaitForMediaCache(videoUrl);

  useEffect(() => {
    if (!videoUrl || !waiting) return;
    let cancelled = false;
    void cacheMediaFirst(videoUrl).then(() => {
      if (!cancelled) setReadyUrl(videoUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [videoUrl, waiting]);

  return waiting ? { imageUrl: posterUrl, posterUrl } : layers;
}
