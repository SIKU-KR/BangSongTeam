import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { stubMatchMedia } from "../test/matchMedia";
import { BELOW_MD_QUERY, BELOW_SM_QUERY, useMediaQuery } from "./useMediaQuery";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMediaQuery", () => {
  it("첫 그림부터 지금 맞는 쿼리인지 답한다", () => {
    stubMatchMedia(BELOW_MD_QUERY);

    const below = renderHook(() => useMediaQuery(BELOW_MD_QUERY));
    const other = renderHook(() => useMediaQuery(BELOW_SM_QUERY));

    expect(below.result.current).toBe(true);
    expect(other.result.current).toBe(false);
  });

  it("화면 폭이 바뀌어 쿼리 결과가 달라지면 다시 그린다", () => {
    const media = stubMatchMedia();
    const { result } = renderHook(() => useMediaQuery(BELOW_MD_QUERY));
    expect(result.current).toBe(false);

    act(() => media.match(BELOW_MD_QUERY));
    expect(result.current).toBe(true);

    act(() => media.match());
    expect(result.current).toBe(false);
  });

  it("떼어 낸 뒤에는 쿼리 변화를 듣지 않는다", () => {
    const media = stubMatchMedia();
    const { unmount } = renderHook(() => useMediaQuery(BELOW_MD_QUERY));
    expect(media.listenerCount(BELOW_MD_QUERY)).toBe(1);

    unmount();

    expect(media.listenerCount(BELOW_MD_QUERY)).toBe(0);
  });

  it("다시 그려도 같은 쿼리를 다시 듣지 않는다", () => {
    const media = stubMatchMedia();
    const { rerender } = renderHook(() => useMediaQuery(BELOW_MD_QUERY));

    rerender();
    rerender();

    expect(media.listenerCount(BELOW_MD_QUERY)).toBe(1);
  });
});
