import { useEffect, useState } from "react";
import {
  cacheMediaFirst,
  getMediaCacheFailure,
  shouldWaitForMediaCache,
} from "../../lib/offline";
import {
  BASE_BACKOFF_MS,
  calculateBackoffWithJitter,
  MAX_BACKOFF_MS,
} from "../../lib/sync/backoff";
import type { BackgroundLayers } from "../backgrounds/backgroundCatalog";

/**
 * 캐시 실패 뒤 타이머로 다시 받는 최대 횟수. 시도마다 파일 전체를 내려받으므로, 넘으면
 * 연결 회복(`online`)이나 탭 복귀·포커스에서만 한 번씩 다시 받는다. 탭 복귀·포커스는 직전
 * 시도가 끝난 뒤 `MAX_BACKOFF_MS`가 지나야 다시 받는다. 창을 오갈 때마다 파일 전체를 다시
 * 받지 않게 하기 위해서다. 저장 공간 부족(`getMediaCacheFailure`가 `quota`)은 다시 받아도
 * 공간을 비우기 전에는 낫지 않으므로 타이머나 탭 복귀·포커스로 다시 받지 않고 연결
 * 회복에서만 다시 받는다.
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
 * 재시도 사이는 최소 `BASE_BACKOFF_MS`를 띄운다. 풀 지터만 쓰면 세 번이 몇 ms 안에 몰려
 * 잠깐의 서버 장애에 한도를 다 쓴다. 한도를 넘긴 뒤에도 연결 회복이나 탭 복귀·포커스에서
 * 다시 받으므로, 화면을 다시 볼 때 포스터에 영영 멈춰 있지 않는다. 받는 중에 온 신호는
 * 같은 다운로드를 기다릴 뿐이므로 무시한다.
 *
 * SW가 페이지를 제어하고 온라인일 때만 기다린다(`shouldWaitForMediaCache`). 그때는 백그라운드
 * 큐나 헤더의 수동 확인(`useProjectionMediaReady`)이 먼저 캐시에 담으면 다음 렌더에서 곧바로
 * 영상을 재생하므로, 미리보기는 헤더가 저장된 것으로 세는 순간에 영상으로 바뀐다. SW 제어
 * 전(첫 방문, 개발 서버)이나 오프라인이면 기다리지 않고 원래 레이어를 그대로 돌려준다.
 * 송출 화면은 배경이 늦게 뜨면 안 되므로 쓰지 않는다.
 */
export function useCacheFirstVideo(layers: BackgroundLayers): BackgroundLayers {
  const { videoUrl, posterUrl } = layers;
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const waiting =
    !!videoUrl && videoUrl !== readyUrl && shouldWaitForMediaCache(videoUrl);

  useEffect(() => {
    if (!videoUrl || !waiting) return;
    let cancelled = false;
    let inProgress = false;
    let attempt = 0;
    let lastFinishedAt = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryCache = async (): Promise<void> => {
      if (inProgress) return;
      inProgress = true;
      clearTimeout(timer);
      timer = undefined;
      const cached = await cacheMediaFirst(videoUrl);
      inProgress = false;
      lastFinishedAt = Date.now();
      if (cancelled) return;
      if (cached) {
        setReadyUrl(videoUrl);
        return;
      }
      if (
        attempt >= MAX_TIMED_RETRIES ||
        getMediaCacheFailure(videoUrl) === "quota"
      ) {
        return;
      }
      timer = setTimeout(
        () => void tryCache(),
        BASE_BACKOFF_MS + calculateBackoffWithJitter(attempt),
      );
      attempt += 1;
    };
    const retryNow = (): void => void tryCache();
    const wake = (): void => {
      if (
        document.visibilityState === "hidden" ||
        timer !== undefined ||
        Date.now() - lastFinishedAt < MAX_BACKOFF_MS ||
        getMediaCacheFailure(videoUrl) === "quota"
      ) {
        return;
      }
      void tryCache();
    };
    window.addEventListener("online", retryNow);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void tryCache();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", retryNow);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [videoUrl, waiting]);

  return waiting ? { imageUrl: posterUrl, posterUrl } : layers;
}
