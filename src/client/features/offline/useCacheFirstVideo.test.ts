import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCacheFirstVideo } from "./useCacheFirstVideo";

const {
  cacheMediaFirst,
  shouldWaitForMediaCache,
  retainMediaUrls,
  releaseMediaUrls,
  listeners,
  progress,
} = vi.hoisted(() => {
  const releaseMediaUrls = vi.fn<(urls: readonly string[]) => void>();
  return {
    cacheMediaFirst: vi.fn<(url: string) => Promise<boolean>>(),
    shouldWaitForMediaCache: vi.fn<(url: string) => boolean>(),
    releaseMediaUrls,
    retainMediaUrls: vi.fn(
      (urls: readonly string[]) => () => releaseMediaUrls(urls),
    ),
    listeners: new Set<() => void>(),
    progress: { version: 0 },
  };
});

vi.mock("../../lib/offline", () => ({
  cacheMediaFirst,
  shouldWaitForMediaCache,
  retainMediaUrls,
  subscribeMediaProgress: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getMediaProgressVersion: () => progress.version,
}));

const VIDEO = "/api/media/loops/a.mp4";
const POSTER = "/api/media/posters/a.webp";
const LAYERS = { videoUrl: VIDEO, posterUrl: POSTER };
const STILL = { imageUrl: POSTER, posterUrl: POSTER };

function deferred(): {
  promise: Promise<boolean>;
  resolve: (v: boolean) => void;
} {
  let resolve: (v: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function notifyProgress(): void {
  progress.version += 1;
  for (const listener of listeners) listener();
}

beforeEach(() => {
  cacheMediaFirst.mockReset();
  shouldWaitForMediaCache.mockReset();
  retainMediaUrls.mockClear();
  releaseMediaUrls.mockClear();
  listeners.clear();
  progress.version = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCacheFirstVideo", () => {
  it("캐시가 끝날 때까지 포스터를 정지 이미지로 그리고, 끝나면 영상을 재생한다", async () => {
    shouldWaitForMediaCache.mockReturnValue(true);
    const cached = deferred();
    cacheMediaFirst.mockReturnValue(cached.promise);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));

    expect(result.current).toEqual(STILL);
    expect(cacheMediaFirst).toHaveBeenCalledWith(VIDEO);

    await act(async () => cached.resolve(true));
    expect(result.current).toEqual(LAYERS);
  });

  it("캐시에 실패하면 포스터를 유지하고, 다시 받기는 큐에 맡겨 따로 다시 받지 않는다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current).toEqual(STILL);
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);
    expect(retainMediaUrls).toHaveBeenCalledWith([VIDEO]);
    expect(releaseMediaUrls).not.toHaveBeenCalled();
  });

  it("큐가 백그라운드에서 다시 받아 담으면 조작 없이 영상을 재생하고 URL을 놓는다", async () => {
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    expect(result.current).toEqual(STILL);

    shouldWaitForMediaCache.mockReturnValue(false);
    act(() => notifyProgress());

    expect(result.current).toEqual(LAYERS);
    expect(releaseMediaUrls).toHaveBeenCalledWith([VIDEO]);
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);
  });

  it("언마운트하면 붙잡은 URL을 놓는다", async () => {
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { unmount } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    unmount();

    expect(releaseMediaUrls).toHaveBeenCalledWith([VIDEO]);
  });

  it("기다릴 필요가 없으면 곧바로 영상을 쓰고 캐시를 앞당기지 않는다", () => {
    shouldWaitForMediaCache.mockReturnValue(false);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));

    expect(result.current).toEqual(LAYERS);
    expect(cacheMediaFirst).not.toHaveBeenCalled();
    expect(retainMediaUrls).not.toHaveBeenCalled();
  });

  it("이미지 배경과 배경 없음은 그대로 돌려준다", () => {
    const image = { imageUrl: "/api/media/stills/a.jpg", posterUrl: POSTER };

    expect(renderHook(() => useCacheFirstVideo(image)).result.current).toBe(
      image,
    );
    expect(renderHook(() => useCacheFirstVideo({})).result.current).toEqual({});
    expect(shouldWaitForMediaCache).not.toHaveBeenCalled();
  });
});
