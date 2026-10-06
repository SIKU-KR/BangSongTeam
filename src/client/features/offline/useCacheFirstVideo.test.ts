import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from "../../lib/sync/backoff";
import { MAX_TIMED_RETRIES, useCacheFirstVideo } from "./useCacheFirstVideo";

const { cacheMediaFirst, getMediaCacheFailure, shouldWaitForMediaCache } =
  vi.hoisted(() => ({
    cacheMediaFirst: vi.fn<(url: string) => Promise<boolean>>(),
    getMediaCacheFailure: vi.fn<(url: string) => string | undefined>(),
    shouldWaitForMediaCache: vi.fn<(url: string) => boolean>(),
  }));

vi.mock("../../lib/offline", () => ({
  cacheMediaFirst,
  getMediaCacheFailure,
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
  getMediaCacheFailure.mockReset();
  shouldWaitForMediaCache.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    expect(result.current).toEqual({ imageUrl: POSTER, posterUrl: POSTER });

    await act(() =>
      vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS + BASE_BACKOFF_MS / 2 - 1),
    );
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(cacheMediaFirst).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(LAYERS);
  });

  it("지터가 0이어도 재시도 사이를 기본 백오프만큼 띄운다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);
    vi.spyOn(Math, "random").mockReturnValue(0);

    renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);

    await act(() => vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS - 1));
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(cacheMediaFirst).toHaveBeenCalledTimes(2);
  });

  it("타이머 재시도는 한도에서 멈추고 그 뒤로는 연결 회복이나 탭 복귀에서 다시 받는다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    for (let i = 0; i < MAX_TIMED_RETRIES + 2; i += 1) {
      await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2));
    }

    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 1);
    expect(result.current).toEqual({ imageUrl: POSTER, posterUrl: POSTER });

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 2);

    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 3);

    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 4);

    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2));
    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 4);
  });

  it("한도를 넘긴 뒤 탭 복귀·포커스가 잇달아 와도 한 번만 다시 받는다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    for (let i = 0; i < MAX_TIMED_RETRIES + 2; i += 1) {
      await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2));
    }
    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS - 1));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 2);

    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 3);
  });

  it("백오프를 기다리는 동안 온 포커스는 재시도를 앞당기지 않는다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);
  });

  it("받는 중에 연결이 돌아와도 같은 다운로드에 재시도 한도를 두 번 쓰지 않는다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    const first = deferred();
    cacheMediaFirst.mockReturnValueOnce(first.promise).mockResolvedValue(false);

    renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(false));
    for (let i = 0; i < MAX_TIMED_RETRIES + 2; i += 1) {
      await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2));
    }

    expect(cacheMediaFirst).toHaveBeenCalledTimes(MAX_TIMED_RETRIES + 1);
  });

  it("저장 공간이 모자라 실패하면 타이머나 탭 복귀로 다시 받지 않고 연결이 돌아올 때만 다시 받는다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);
    getMediaCacheFailure.mockReturnValue("quota");

    renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2));

    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(cacheMediaFirst).toHaveBeenCalledTimes(2);
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
    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2));
    expect(cacheMediaFirst).toHaveBeenCalledTimes(1);
  });

  it("언마운트하면 재시도를 멈춘다", async () => {
    vi.useFakeTimers();
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { unmount } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);
    unmount();

    await act(() => vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));

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
