import { useEffect, useMemo, useRef } from "react";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  type Presentation,
} from "#shared";
import {
  getMediaCacheFailure,
  resumeMediaCaching,
  retainMediaUrls,
  scheduleMediaCaching,
  warmPresentationFonts,
} from "../../lib/offline";
import type { SyncRetryMode } from "../../lib/sync/backoff";
import { subscribeSyncRecovery } from "../../lib/sync/syncRecovery";
import { useBackgroundLookup } from "../backgrounds/backgroundCatalog";
import { useLatest } from "../../hooks/useLatest";

export const AUTO_CACHE_DELAY_MS = 3000;

function useRetainedMediaUrls(
  urlsRef: { readonly current: readonly string[] },
  key: string | null,
): void {
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const release = key === null ? null : retainMediaUrls(urlsRef.current);
    releaseRef.current?.();
    releaseRef.current = release;
  }, [key]);

  useEffect(
    () => () => {
      releaseRef.current?.();
      releaseRef.current = null;
    },
    [],
  );
}

/**
 * 열려 있는 세트의 배경 영상·포스터와 글꼴을 조용히 캐시에 담는다.
 *
 * 배경 URL은 로컬 배경 카탈로그에서 찾는다. 카탈로그가 바뀌면(방금 올린 커스텀
 * 배경을 곡에 지정, 동기화로 목록 갱신) 새로 생긴 URL도 곧바로 캐시 대상이 된다.
 *
 * 큐에 넣는 것은 지연 뒤지만 URL은 열자마자 붙잡는다(`retainMediaUrls`). 그 사이 미리보기
 * (`useCacheFirstVideo`)가 먼저 받다 실패해도 큐가 백오프로 다시 받는다. 배경을 바꾸면 새
 * URL을 먼저 붙잡은 뒤 지난 URL을 놓는다. 두 세트에 함께 있는 URL이 잠깐이라도 놓이면
 * 기다리던 재시도와 시도 횟수가 지워져, SW가 아직 받고 있을 수 있는 파일을 곧바로 다시 받는다.
 *
 * 연결이 회복되면(`subscribeSyncRecovery`: `online`·탭 복귀·포커스·상태 확인 성공)
 * 프레젠테이션의 URL을 다시 넣는다. 기다리던 재시도는 회복 경로가 `resumeMediaCaching`으로 먼저 깨운다.
 * 포커스·탭 복귀(`wake`)에는 이미 실패한 URL을 넣지 않고, `online`에도 저장 공간 부족으로
 * 실패한 URL은 넣지 않는다. 다시 넣으면 영상을 끝까지 받은 뒤에야 같은 실패를 알게 되어,
 * 포커스마다 큰 파일을 처음부터 다시 받는다. '다시 시도'(`manual`)만 모두 넣는다.
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

  useRetainedMediaUrls(urlsRef, presentationId ? urlKey : null);

  useEffect(
    () =>
      subscribeSyncRecovery((mode) =>
        scheduleMediaCaching(
          urlsRef.current.filter((url) => shouldRequeueOnRecovery(url, mode)),
        ),
      ),
    [],
  );
}

function shouldRequeueOnRecovery(url: string, mode: SyncRetryMode): boolean {
  const failure = getMediaCacheFailure(url);
  if (mode === "manual" || failure === undefined) return true;
  return mode === "reconnect" && failure !== "quota";
}

/**
 * 송출 화면의 배경 캐시. 송출을 시작하면 세트가 쓰는 배경을 지연 없이 모두 큐에 넣는다.
 *
 * 큐는 한 번에 하나씩 받으므로 순서가 곧 우선순위다. 지금 곡과 다음 곡 배경을 맨 앞에
 * 세우고, 곡이 바뀔 때마다 새 지금·다음 곡을 다시 앞으로 당긴다. 곡 순번은 송출 라우트와
 * 같게 `presentation.items`의 배열 순서를 따른다. 글꼴은 `usePresentationFontsReady`가 맡는다.
 * 송출하는 동안 세트의 URL을 붙잡아 받다 실패한 배경을 백오프로 다시 받는다.
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

  useRetainedMediaUrls(allUrlsRef, allKey);

  useEffect(() => {
    const scheduleAll = (): void => {
      scheduleMediaCaching(focusUrlsRef.current, { priority: true });
      scheduleMediaCaching(allUrlsRef.current);
    };
    const handleOnline = (): void => {
      resumeMediaCaching();
      scheduleAll();
    };
    scheduleAll();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [focusKey, allKey]);
}
