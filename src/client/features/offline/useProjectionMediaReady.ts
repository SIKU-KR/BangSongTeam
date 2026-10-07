import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  collectPresentationMediaAssets,
  type BackgroundMedia,
  type Presentation,
} from "#shared";
import {
  cacheMediaFirst,
  ensureMediaSpace,
  findCachedMediaUrls,
  getMediaCacheFailure,
  getMediaProgress,
  getMediaProgressVersion,
  getMediaQueueState,
  scheduleMediaCaching,
  subscribeMediaProgress,
} from "../../lib/offline";
import { useBackgroundLookup } from "../backgrounds/backgroundCatalog";
import { useLatest } from "../../hooks/useLatest";
import { navigatorApi } from "../../lib/browser/optionalApis";

export type ProjectionMediaStatus =
  "checking" | "downloading" | "ready" | "failed";

/**
 * - `offline`: 인터넷이 끊겨 빠진 영상을 받을 수 없다
 * - `quota`: 기기 저장 공간이 모자라다
 * - `network`: 연결은 됐지만 받다가 실패했다 (다시 시도하면 될 수 있다)
 */
export type ProjectionMediaFailure = "offline" | "quota" | "network";

export interface ProjectionMediaReadiness {
  status: ProjectionMediaStatus;
  failure: ProjectionMediaFailure | null;
  /** `passive`에서 받다 실패한 영상을 큐가 곧 다시 받으려고 기다리는 중이다 */
  retrying: boolean;
  readyCount: number;
  totalCount: number;
  receivedBytes: number;
  totalBytes: number;
  retry: () => void;
}

interface MediaFile {
  url: string;
  sizeBytes: number;
}

interface RunState {
  key: string;
  status: ProjectionMediaStatus;
  failure: ProjectionMediaFailure | null;
  readyUrls: ReadonlySet<string>;
}

const SERVICE_WORKER_READY_TIMEOUT_MS = 3000;
export const PASSIVE_RECHECK_MS = 2000;

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function failureOf(url: string): ProjectionMediaFailure {
  if (getMediaCacheFailure(url) === "quota") return "quota";
  return isOffline() ? "offline" : "network";
}

type PassiveQueueState = "active" | "retrying" | "gaveUp" | "idle";

function passiveQueueState(
  files: readonly MediaFile[],
  readyUrls: ReadonlySet<string>,
): PassiveQueueState {
  const missing = files
    .map((file) => file.url)
    .filter((url) => !readyUrls.has(url));
  const states = missing.map(getMediaQueueState);
  if (states.some((state) => state === "downloading" || state === "queued")) {
    return "active";
  }
  if (states.includes("retrying")) return "retrying";
  return missing.some((url) => getMediaCacheFailure(url) !== undefined)
    ? "gaveUp"
    : "idle";
}

function hitQuota(
  urls: readonly string[],
  readyUrls: ReadonlySet<string>,
): boolean {
  return urls.some(
    (url) => !readyUrls.has(url) && getMediaCacheFailure(url) === "quota",
  );
}

/**
 * 처음 설치된 SW가 페이지를 제어하기를 잠깐 기다린다(`clientsClaim`). 제어받기 전에
 * 받으면 SW 캐시가 아니라 페이지가 직접 캐시에 담는데, 그래도 캐시본은 같으므로
 * 끝내 제어받지 못해도 그냥 진행한다.
 */
async function waitForServiceWorker(): Promise<void> {
  const serviceWorker = navigatorApi("serviceWorker");
  if (!serviceWorker || serviceWorker.controller) return;
  await Promise.race([
    serviceWorker.ready.catch(() => undefined),
    new Promise((resolve) =>
      setTimeout(resolve, SERVICE_WORKER_READY_TIMEOUT_MS),
    ),
  ]);
}

async function requeueMissing(files: readonly MediaFile[]): Promise<void> {
  const urls = files.map((file) => file.url);
  const cached = new Set(await findCachedMediaUrls(urls));
  const missing = files.filter((file) => !cached.has(file.url));
  if (missing.length === 0) return;
  const neededBytes = missing.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (!(await ensureMediaSpace(neededBytes, urls))) return;
  scheduleMediaCaching(
    missing.map((file) => file.url),
    { priority: true },
  );
}

function collectMediaFiles(
  presentation: Presentation | null,
  findBackground: (id: string) => BackgroundMedia | undefined,
): MediaFile[] {
  if (!presentation) return [];
  const files = new Map<string, MediaFile>();
  for (const asset of collectPresentationMediaAssets(
    presentation,
    findBackground,
  )) {
    if (!asset.mediaUrl || !asset.backgroundId || files.has(asset.mediaUrl)) {
      continue;
    }
    files.set(asset.mediaUrl, {
      url: asset.mediaUrl,
      sizeBytes: findBackground(asset.backgroundId)?.sizeBytes ?? 0,
    });
  }
  return [...files.values()];
}

function useMediaProgressVersion(): number {
  return useSyncExternalStore(
    subscribeMediaProgress,
    getMediaProgressVersion,
    getMediaProgressVersion,
  );
}

/**
 * 송출 전에 세트가 쓰는 배경 영상·이미지 원본을 모두 이 기기에 받아 둔다.
 *
 * 배경 영상은 하나에 수백 MB일 수 있어, 받는 도중에 송출을 시작하면 예배 중에
 * 네트워크가 끊겼을 때 배경이 멈춘다. 그래서 송출 화면은 `ready`가 되거나 운영자가
 * 저장된 배경으로 시작할 때까지 슬라이드를 띄우지 않는다. 받기 전에 모자란 저장 공간을 세트 밖의 영상을 지워 확보한다
 * (`ensureMediaSpace`). 포스터는 작아서 기다리지 않는다 — 기존 백그라운드 큐가 받는다.
 *
 * 총 용량은 카탈로그의 `sizeBytes`(영상+포스터)로 먼저 잡고, 받기 시작하면 응답
 * 길이로 바꾼다.
 *
 * 준비 중에 Cache Storage 등이 예상 밖으로 실패해도 `failed`로 끝낸다. `checking`에
 * 머무르면 준비 카드가 멈춘 채로 남는다.
 *
 * `passive`면 직접 받지 않고 저장 상태만 본다. 편집기는 자동 캐시
 * (`useBackgroundAutoCache`)가 이미 받고 있으므로 송출 버튼 옆에 진행만 보여 준다.
 * 다만 자동 캐시가 저장 공간 부족으로 실패했으면 `failed`/`quota`로 알린다. 알리지 않으면
 * 편집기는 끝나지 않을 '배경 저장 중'만 보여 준다. 공간이 생겨 저장되면 다시 확인할 때
 * 풀린다. 큐가 받다 실패한 영상을 백오프 뒤 다시 받으려고 기다리는 동안은 `retrying`을
 * 켠다. 다시 받아 저장되면 주기적인 확인이 `ready`로 바꾸므로 따로 조작할 필요가 없다. 큐가
 * 재시도를 다 쓰거나 다시 받아도 낫지 않는 실패(4xx)로 멈추면 `failed`로 알린다. 그때
 * `retry`하면 세트 밖 영상을 지워 자리를 만든 뒤(`ensureMediaSpace`) 빠진 영상을 큐 맨 앞에
 * 다시 넣는다. 다 지워도 자리가 없으면 다시 넣지 않는다. 수백 MB를 다시 받아 봐야 같은
 * 한도에 걸리고, 그동안 헤더만 '저장 중'으로 돌아간다.
 *
 * 받다가 저장 공간 부족으로 실패하면 연결이 끊겼더라도 `quota`로 알린다. 다시 연결해도
 * 공간을 비우기 전에는 낫지 않기 때문이다.
 */
export function useProjectionMediaReady(
  presentation: Presentation | null,
  options: { passive?: boolean } = {},
): ProjectionMediaReadiness {
  const passive = options.passive ?? false;
  const findBackground = useBackgroundLookup();

  const files = useMemo(
    () => collectMediaFiles(presentation, findBackground),
    [presentation, findBackground],
  );
  const filesRef = useLatest(files);
  const [attempt, setAttempt] = useState(0);
  const key = `${passive}|${attempt}|${files.map((file) => file.url).join("|")}`;
  const [run, setRun] = useState<RunState>({
    key: "",
    status: "checking",
    failure: null,
    readyUrls: new Set(),
  });

  useEffect(() => {
    let cancelled = false;
    const update = (next: Omit<RunState, "key">): void => {
      if (!cancelled) setRun({ key, ...next });
    };
    const files = filesRef.current;
    const urls = files.map((file) => file.url);

    if (passive) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = async (): Promise<void> => {
        const readyUrls = new Set(
          await findCachedMediaUrls(urls).catch((): string[] => []),
        );
        const ready = readyUrls.size === urls.length;
        const quota = !ready && hitQuota(urls, readyUrls);
        update({
          status: ready ? "ready" : quota ? "failed" : "downloading",
          failure: quota ? "quota" : null,
          readyUrls,
        });
        if (!ready && !cancelled)
          timer = setTimeout(() => void check(), PASSIVE_RECHECK_MS);
      };
      void (attempt > 0 ? requeueMissing(files) : Promise.resolve())
        .catch(() => undefined)
        .then(check);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    const readyUrls = new Set<string>();
    const prepare = async (): Promise<void> => {
      for (const url of await findCachedMediaUrls(urls)) readyUrls.add(url);
      const missing = files.filter((file) => !readyUrls.has(file.url));
      if (missing.length === 0) {
        update({ status: "ready", failure: null, readyUrls });
        return;
      }
      if (isOffline()) {
        update({ status: "failed", failure: "offline", readyUrls });
        return;
      }
      await waitForServiceWorker();
      const neededBytes = missing.reduce(
        (sum, file) => sum + file.sizeBytes,
        0,
      );
      if (!(await ensureMediaSpace(neededBytes, urls))) {
        update({ status: "failed", failure: "quota", readyUrls });
        return;
      }

      update({
        status: "downloading",
        failure: null,
        readyUrls: new Set(readyUrls),
      });
      for (const file of missing) {
        if (cancelled) return;
        if (!(await cacheMediaFirst(file.url))) {
          update({ status: "failed", failure: failureOf(file.url), readyUrls });
          return;
        }
        readyUrls.add(file.url);
        update({
          status: "downloading",
          failure: null,
          readyUrls: new Set(readyUrls),
        });
      }
      update({ status: "ready", failure: null, readyUrls });
    };
    prepare().catch(() =>
      update({
        status: "failed",
        failure: isOffline() ? "offline" : "network",
        readyUrls: new Set(readyUrls),
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [key]);

  useMediaProgressVersion();
  const current: RunState =
    run.key === key
      ? run
      : {
          key,
          status: files.length === 0 ? "ready" : "checking",
          failure: null,
          readyUrls: new Set(),
        };

  let receivedBytes = 0;
  let totalBytes = 0;
  for (const file of files) {
    const progress = getMediaProgress(file.url);
    const size = progress?.total ?? file.sizeBytes;
    totalBytes += size;
    receivedBytes += current.readyUrls.has(file.url)
      ? size
      : Math.min(progress?.received ?? 0, size);
  }

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const queue =
    passive && current.status === "downloading"
      ? passiveQueueState(files, current.readyUrls)
      : "idle";
  const failedUrl =
    queue === "gaveUp"
      ? files.find(
          (file) =>
            !current.readyUrls.has(file.url) &&
            getMediaCacheFailure(file.url) !== undefined,
        )?.url
      : undefined;

  return {
    status: failedUrl ? "failed" : current.status,
    failure: failedUrl ? failureOf(failedUrl) : current.failure,
    retrying: queue === "retrying",
    readyCount: current.readyUrls.size,
    totalCount: files.length,
    receivedBytes,
    totalBytes,
    retry,
  };
}
