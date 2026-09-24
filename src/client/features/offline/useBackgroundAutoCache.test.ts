import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Presentation } from "#shared";
import { SEED_PRESENTATIONS } from "../presentation";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../backgrounds/backgroundCatalog";
import {
  makeBackground,
  TEST_SERVICE_BACKGROUNDS,
} from "../../test/backgroundFixture";
import {
  useBackgroundAutoCache,
  AUTO_CACHE_DELAY_MS,
} from "./useBackgroundAutoCache";

const { scheduleMediaCaching, warmPresentationFonts } = vi.hoisted(() => ({
  scheduleMediaCaching: vi.fn(),
  warmPresentationFonts: vi.fn(async () => undefined),
}));

vi.mock("../../lib/offline", () => ({
  scheduleMediaCaching,
  warmPresentationFonts,
}));

const BASE = SEED_PRESENTATIONS[0];

function withBackground(backgroundId: string): Presentation {
  return {
    ...BASE,
    items: BASE.items.map((item) =>
      item.deck ? { ...item, deck: { ...item.deck, backgroundId } } : item,
    ),
  };
}

function urlsOf(backgroundId: string): string[] {
  const background = TEST_SERVICE_BACKGROUNDS.find(
    (bg) => bg.id === backgroundId,
  );
  return background ? [background.mediaUrl, background.posterUrl] : [];
}

const BG_A = TEST_SERVICE_BACKGROUNDS[0].id;
const BG_B = TEST_SERVICE_BACKGROUNDS[1].id;
const BG_C = TEST_SERVICE_BACKGROUNDS[2].id;

beforeEach(() => {
  setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
  vi.useFakeTimers();
  scheduleMediaCaching.mockClear();
  warmPresentationFonts.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  resetBackgroundCatalogForTests();
});

describe("useBackgroundAutoCache", () => {
  it("지연이 지나면 세트의 배경 영상·포스터를 중복 없이 큐에 넣는다", () => {
    const presentation = withBackground(BG_A);
    renderHook(() => useBackgroundAutoCache(presentation));

    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS - 1);
    });
    expect(scheduleMediaCaching).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(scheduleMediaCaching).toHaveBeenCalledTimes(1);
    expect(scheduleMediaCaching).toHaveBeenCalledWith(urlsOf(BG_A));
  });

  it("같은 때 가사에 쓰인 글꼴도 데운다", () => {
    const presentation = withBackground(BG_A);
    renderHook(() => useBackgroundAutoCache(presentation));

    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    expect(warmPresentationFonts).toHaveBeenCalledWith(presentation);
  });

  it("지연 안에서 배경을 여러 번 바꾸면 마지막 것만 받는다", () => {
    const { rerender } = renderHook(({ p }) => useBackgroundAutoCache(p), {
      initialProps: { p: withBackground(BG_A) },
    });

    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS / 2);
    });
    rerender({ p: withBackground(BG_B) });
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS / 2);
    });
    rerender({ p: withBackground(BG_C) });
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    expect(scheduleMediaCaching).toHaveBeenCalledTimes(1);
    expect(scheduleMediaCaching).toHaveBeenCalledWith(urlsOf(BG_C));
  });

  it("받은 뒤 배경을 바꾸면 새 배경을 다시 큐에 넣는다", () => {
    const { rerender } = renderHook(({ p }) => useBackgroundAutoCache(p), {
      initialProps: { p: withBackground(BG_A) },
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    rerender({ p: withBackground(BG_B) });
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    expect(scheduleMediaCaching).toHaveBeenCalledTimes(2);
    expect(scheduleMediaCaching).toHaveBeenLastCalledWith(urlsOf(BG_B));
  });

  it("배경이 그대로면 가사를 고쳐도 다시 큐에 넣지 않는다", () => {
    const presentation = withBackground(BG_A);
    const { rerender } = renderHook(({ p }) => useBackgroundAutoCache(p), {
      initialProps: { p: presentation },
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    rerender({ p: { ...presentation, title: "수정된 제목" } });
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    expect(scheduleMediaCaching).toHaveBeenCalledTimes(1);
  });

  it("네트워크가 돌아오면 곧바로 다시 큐에 넣는다", () => {
    const presentation = withBackground(BG_A);
    renderHook(() => useBackgroundAutoCache(presentation));
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(scheduleMediaCaching).toHaveBeenCalledTimes(2);
    expect(scheduleMediaCaching).toHaveBeenLastCalledWith(urlsOf(BG_A));
  });

  it("지연 전에 화면을 떠나면 아무것도 받지 않는다", () => {
    const { unmount } = renderHook(() =>
      useBackgroundAutoCache(withBackground(BG_A)),
    );

    unmount();
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
      window.dispatchEvent(new Event("online"));
    });

    expect(scheduleMediaCaching).not.toHaveBeenCalled();
  });

  it("방금 올린 배경이 카탈로그에 들어오면 그 배경도 받는다", () => {
    const upload = makeBackground(7, {
      kind: "image",
      mediaUrl: "/api/media/stills/bg7.png",
      posterUrl: "/api/media/stills/bg7.png",
    });
    renderHook(() => useBackgroundAutoCache(withBackground(upload.id)));
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });
    expect(scheduleMediaCaching).toHaveBeenLastCalledWith([]);

    act(() => {
      setBackgroundCatalogForTests([...TEST_SERVICE_BACKGROUNDS, upload]);
    });
    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    expect(scheduleMediaCaching).toHaveBeenLastCalledWith([
      "/api/media/stills/bg7.png",
    ]);
  });

  it("세트가 없으면 아무것도 하지 않는다", () => {
    renderHook(() => useBackgroundAutoCache(null));

    act(() => {
      vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
    });

    expect(scheduleMediaCaching).not.toHaveBeenCalled();
    expect(warmPresentationFonts).not.toHaveBeenCalled();
  });
});
