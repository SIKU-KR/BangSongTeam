import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
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

  it("캐시에 실패해도 영상을 스트리밍으로 재생한다", async () => {
    shouldWaitForMediaCache.mockReturnValue(true);
    cacheMediaFirst.mockResolvedValue(false);

    const { result } = renderHook(() => useCacheFirstVideo(LAYERS));
    await act(async () => undefined);

    expect(result.current).toEqual(LAYERS);
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
