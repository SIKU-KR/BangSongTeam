import { useEffect, useState } from "react";
import { cacheMediaFirst, shouldWaitForMediaCache } from "../../lib/offline";
import { calculateBackoffWithJitter } from "../../lib/sync/backoff";
import type { BackgroundLayers } from "../backgrounds/backgroundCatalog";

/**
 * 캐시 실패 뒤 타이머로 다시 받는 최대 횟수. 저장 공간 부족처럼 다시 받아도 낫지 않는
 * 실패에서도 시도마다 파일 전체를 내려받으므로, 넘으면 `online` 이벤트에서만 다시 받는다.
 */
export const MAX_TIMED_RETRIES = 3;

/**
 * 편집기 배경 영상을 캐시에 다 담은 뒤에 재생한다. 그동안은 포스터를 정지 이미지로 그린다.
 *
 * 곧바로 `<video>`를 붙이면 영상은 Range(206)로 스트리밍되어 캐시에 남지 않고,
 * 백그라운드 캐시가 같은 파일을 처음부터 다시 받는다. 느린 네트워크에서는 둘이 대역폭을
 * 나눠 쓴다. 캐시를 먼저 채우면 SW가 캐시본을 잘라 재생하므로 전체 다운로드가 한 번이다.
 *
 * 캐시에 실패하면 스트리밍으로 넘어가지 않고 포스터를 유지한 채 지수 백오프로 다시 받는다.
 * 캐시본 없이 재생되면 배경이 저장된 것처럼 보이다가 오프라인 예배에서 멈추기 때문이다.
 * 재시도 횟수는 `MAX_TIMED_RETRIES`로 묶는다.
 *
 * 백그라운드 큐나 헤더의 수동 확인(`useProjectionMediaReady`)이 먼저 캐시에 담으면 다음
 * 렌더에서 `shouldWaitForMediaCache`가 false가 되어 곧바로 영상을 재생한다. 그래서 미리보기는
 * 헤더가 저장된 것으로 세는 순간에만 영상으로 바뀐다. 송출 화면은 배경이 늦게 뜨면 안
 * 되므로 쓰지 않는다.
 */
export function useCacheFirstVideo(layers: BackgroundLayers): BackgroundLayers {
  const { videoUrl, posterUrl } = layers;
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const waiting =
    !!videoUrl && videoUrl !== readyUrl && shouldWaitForMediaCache(videoUrl);

  useEffect(() => {
    if (!videoUrl || !waiting) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryCache = async (): Promise<void> => {
      clearTimeout(timer);
      const cached = await cacheMediaFirst(videoUrl);
      if (cancelled) return;
      if (cached) {
        setReadyUrl(videoUrl);
        return;
      }
      clearTimeout(timer);
      if (attempt >= MAX_TIMED_RETRIES) return;
      timer = setTimeout(
        () => void tryCache(),
        calculateBackoffWithJitter(attempt),
      );
      attempt += 1;
    };
    const retryNow = (): void => void tryCache();
    window.addEventListener("online", retryNow);
    void tryCache();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", retryNow);
    };
  }, [videoUrl, waiting]);

  return waiting ? { imageUrl: posterUrl, posterUrl } : layers;
}
