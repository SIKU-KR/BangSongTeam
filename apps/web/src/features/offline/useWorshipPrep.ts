import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  type Presentation,
  type PresentationMediaAsset,
} from "@repo/shared";
import {
  cacheMediaUrls,
  getCachedUrls,
  isCacheStorageAvailable,
  requestPersistentStorage,
  estimateStorageUsage,
  warmPresentationFonts,
  type MediaCacheItem,
  type StorageEstimate,
  type StoragePersistenceState,
} from "../../lib/offline";
import {
  loadOfflineStatus,
  saveOfflineStatus,
  reportPersistenceError,
} from "../../lib/storage";

/**
 * 예배 준비 화면의 오케스트레이션.
 *
 * 흐름: 이미 받아 둔 것 확인 → 영구 저장소 요청 → 글꼴 워밍 → 남은 자산 다운로드
 * → `sync_meta`에 결과 기록.
 *
 * 준비가 실패해도 송출 자체를 막지 않는다 (2026-09-22 결정: 권장 관문). 영상이
 * 없다고 예배를 못 하게 만드는 것이 더 큰 사고다.
 */

export type WorshipPrepPhase =
  | "checking"
  | "preparing"
  | "ready"
  | "incomplete"
  | "unsupported";

export interface WorshipPrepState {
  phase: WorshipPrepPhase;
  /** 곡별 배경 자산 (배경이 없는 곡도 포함) */
  assets: PresentationMediaAsset[];
  /** URL별 다운로드 상태 */
  items: MediaCacheItem[];
  /** 0~1 진행률 */
  progress: number;
  /** 받은 총 바이트 */
  totalBytes: number;
  /** 모든 자산이 캐시에 들어갔는지 — '오프라인 송출 가능' 배지 조건 */
  isReady: boolean;
  storage: StoragePersistenceState | null;
  estimate: StorageEstimate | null;
}

export interface WorshipPrep extends WorshipPrepState {
  /** 다운로드를 시작(또는 재시도)한다 */
  start: () => void;
}

function itemsFromCached(
  urls: readonly string[],
  cached: ReadonlySet<string>,
): MediaCacheItem[] {
  return urls.map((url) => ({
    url,
    status: cached.has(url) ? "done" : "pending",
    bytes: 0,
  }));
}

export function useWorshipPrep(
  presentation: Presentation | null,
  options: { autoStart?: boolean } = {},
): WorshipPrep {
  const { autoStart = true } = options;

  const assets = useMemo(
    () => (presentation ? collectPresentationMediaAssets(presentation) : []),
    [presentation],
  );
  const urls = useMemo(() => collectUniqueMediaUrls(assets), [assets]);
  // 이펙트 의존성으로 쓰기 위한 안정적인 키. 배열 identity는 매 렌더 바뀐다.
  const urlKey = urls.join("|");

  const [phase, setPhase] = useState<WorshipPrepPhase>("checking");
  const [items, setItems] = useState<MediaCacheItem[]>([]);
  const [storage, setStorage] = useState<StoragePersistenceState | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

  const run = useCallback(async () => {
    const target = presentationRef.current;
    if (!target || runningRef.current) return;
    if (!isCacheStorageAvailable()) {
      setPhase("unsupported");
      return;
    }

    runningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("preparing");

    try {
      // 사용자 제스처 흐름 안에서 부르는 편이 승인 확률이 높다.
      const persistence = await requestPersistentStorage();
      setStorage(persistence);

      // 글꼴은 프리캐시 대상이 아니라 런타임 캐시 대상이다. 여기서 데워 둬야
      // 오프라인 송출에서 가사가 대체 글꼴로 나오지 않는다.
      await warmPresentationFonts(target);
      if (controller.signal.aborted) return;

      const result = await cacheMediaUrls(urls, {
        signal: controller.signal,
        onProgress: setItems,
      });
      if (controller.signal.aborted) return;

      setItems(result.items);
      setEstimate(await estimateStorageUsage());
      setPhase(result.isComplete ? "ready" : "incomplete");

      await saveOfflineStatus(target.id, {
        isReady: result.isComplete,
        cachedVideos: result.cachedUrls,
        cachedAt: Date.now(),
        storagePersisted: persistence === "persisted",
      });
    } catch (err) {
      // 저장 실패는 삼키지 않는다 (M3-A 원칙). 준비 자체는 실패로 표시하되
      // 송출 경로는 열어 둔다.
      reportPersistenceError(err);
      setPhase("incomplete");
    } finally {
      runningRef.current = false;
      abortRef.current = null;
    }
  }, [urls]);

  // 이미 받아 둔 것이 있으면 다시 받지 않고 곧바로 준비 완료로 보여 준다.
  useEffect(() => {
    if (!presentation) return;
    let cancelled = false;

    void (async () => {
      if (!isCacheStorageAvailable()) {
        if (!cancelled) setPhase("unsupported");
        return;
      }

      const [cached, saved] = await Promise.all([
        getCachedUrls(urls),
        loadOfflineStatus(presentation.id).catch(() => null),
      ]);
      if (cancelled) return;

      setItems(itemsFromCached(urls, cached));
      if (saved) {
        setStorage(saved.storagePersisted ? "persisted" : null);
      }

      const complete = urls.length > 0 && cached.size === urls.length;
      if (complete) {
        setPhase("ready");
        setEstimate(await estimateStorageUsage());
        return;
      }
      if (autoStart) {
        void run();
      } else {
        setPhase("incomplete");
      }
    })();

    return () => {
      cancelled = true;
    };
    // urls 배열은 매 렌더 새 identity라 의존성에 넣을 수 없다. urlKey가 그
    // 집합의 실제 변화를 대신 추적한다.
  }, [presentation, urlKey, autoStart, run, urls]);

  // 화면을 떠나면 진행 중인 다운로드를 멈춘다.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const doneCount = items.filter((item) => item.status === "done").length;
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);

  return {
    phase,
    assets,
    items,
    progress: items.length === 0 ? 0 : doneCount / items.length,
    totalBytes,
    isReady: phase === "ready",
    storage,
    estimate,
    start: () => {
      void run();
    },
  };
}
