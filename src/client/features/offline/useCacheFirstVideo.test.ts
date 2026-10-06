import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MAX_BACKOFF_MS } from "../../lib/sync/backoff";
import { useCacheFirstVideo } from "./useCacheFirstVideo";

const { cacheMediaFirst, shouldWaitForMediaCache } = vi.hoisted(() => ({
  cacheMediaFirst: vi.fn<(url: string) => Promise<boolean>>(),
  shouldWaitForMediaCache: vi.fn<(url: string) => boolean>(),
}));

vi.mock("../../lib/offline", () => ({
  cacheMediaFirst,
  shouldWaitForMediaCache,
}));

const VIDEO = "/api/media/loops/a.mp4";
const POSTER = "/api/media/posters/a.webp";
const LAYERS = { videoUrl: VIDEO, posterUrl: POSTER };

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

beforeEach(() => {
  cacheMediaFirst.mockReset();
  shouldWaitForMediaCache.mockReset();
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

    expect(result.current).toEqual({ imageUrl: POSTER, posterUrl: POSTER });
    expect(cacheMediaFirst).toHaveBeenCalledWith(VIDEO);

    await act(async () => cached.resolve(true));
    expect(result.current).toEqual(LAYERS);
  });

  it("캐시에 실패하면 영상으로 바꾸지 않고 포스터를 유지한다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);

    expect(result.current).toEqual({ imageUrl: POSTER, posterUrl: POSTER });
  });

  it("실패하면 백오프 뒤 다시 받고, 담기면 영상을 재생한다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    expect(result.current).toEqual({ imageUrl: POSTER, posterUrl: POSTER });

    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS));

    expect(cacheMediaFirst).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(LAYERS);
  });

  it("연결이 돌아오면 기다리지 않고 다시 받는다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(cacheMediaFirst).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(LAYERS);
  });

  it("다른 경로로 캐시에 담기면 백오프를 기다리지 않고 영상을 재생한다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { result, rerender } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    expect(result.current).toEqual({ imageUrl: POSTER, posterUrl: POSTER });

    shouldWaitForMediaCache.mockReturnValue(false);
    rerender();

    expect(result.current).toEqual(LAYERS);
    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS));
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);
  });

  it("언마운트하면 재시도를 멈춘다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { unmount } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    unmount();

    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS));
    window.dispatchEvent(new Event("online"));

    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);
  });

  it("기다릴 필요가 없으면 곧바로 영상을 쓰고 캐시를 앞당기지 않는다", () => {
    shouldWaitForMediaCache.mockReturnValue(false);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));

    expect(result.current).toEqual(LAYERS);
    expect(cacheMediaFirst).not.toHaveBeenCalled();
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
