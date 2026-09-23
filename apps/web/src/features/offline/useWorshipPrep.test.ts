import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  DEFAULT_DECK_STYLE,
  INITIAL_BACKGROUNDS,
  MEDIA_CACHE_NAME,
  type Deck,
  type Presentation,
} from "@repo/shared";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import { getOfflineDB } from "../../lib/storage/db";
import { loadOfflineStatus } from "../../lib/storage";
import { useWorshipPrep } from "./useWorshipPrep";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PRESENTATION_ID = "10000000-0000-4000-8000-000000000001";
const NOW = "2026-09-22T00:00:00.000Z";

function makeDeck(index: number, backgroundId: string | null): Deck {
  return {
    id: `20000000-0000-4000-8000-00000000000${index}`,
    userId: USER_ID,
    scope: "presentation",
    presentationId: PRESENTATION_ID,
    title: `곡 ${index}`,
    artist: "",
    lyricsRaw: "은혜로다",
    slides: [{ id: `s${index}`, order: 0, lines: ["은혜로다"] }],
    backgroundId,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  } as Deck;
}

function makePresentation(backgroundIds: (string | null)[]): Presentation {
  return {
    id: PRESENTATION_ID,
    userId: USER_ID,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    items: backgroundIds.map((backgroundId, index) => ({
      id: `30000000-0000-4000-8000-00000000000${index + 1}`,
      presentationId: PRESENTATION_ID,
      deckId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      order: index,
      deck: makeDeck(index + 1, backgroundId),
    })),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

beforeEach(async () => {
  resetFakeCacheStorage();
  const db = await getOfflineDB();
  await db.clear("sync_meta");
  globalThis.fetch = vi.fn(
    async () => new Response(new ArrayBuffer(1024), { status: 200 }),
  ) as unknown as typeof fetch;
  Object.defineProperty(navigator, "storage", {
    value: {
      persisted: async () => false,
      persist: async () => true,
      estimate: async () => ({ usage: 2048, quota: 1_000_000 }),
    },
    configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) {
    Object.defineProperty(navigator, "storage", originalStorage);
  }
  vi.restoreAllMocks();
});

describe("useWorshipPrep", () => {
  it("세트의 배경을 모두 받으면 오프라인 준비 완료가 된다", async () => {
    const presentation = makePresentation([INITIAL_BACKGROUNDS[0].id]);

    const { result } = renderHook(() => useWorshipPrep(presentation));

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.isReady).toBe(true);
    expect(result.current.progress).toBe(1);
    expect(result.current.totalBytes).toBe(2048); // 영상 + 포스터
  });

  it("영구 저장소 요청 결과를 노출한다", async () => {
    const presentation = makePresentation([INITIAL_BACKGROUNDS[0].id]);

    const { result } = renderHook(() => useWorshipPrep(presentation));

    await waitFor(() => expect(result.current.storage).toBe("persisted"));
  });

  it("결과를 sync_meta에 기록한다", async () => {
    const presentation = makePresentation([INITIAL_BACKGROUNDS[0].id]);

    const { result } = renderHook(() => useWorshipPrep(presentation));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    const status = await loadOfflineStatus(PRESENTATION_ID);
    expect(status.isReady).toBe(true);
    expect(status.storagePersisted).toBe(true);
    expect(status.cachedVideos.length).toBe(2);
    expect(status.cachedAt).toBeGreaterThan(0);
  });

  it("곡별 자산 목록에 배경 없는 곡도 남긴다", async () => {
    const presentation = makePresentation([INITIAL_BACKGROUNDS[0].id, null]);

    const { result } = renderHook(() => useWorshipPrep(presentation));

    await waitFor(() => expect(result.current.assets).toHaveLength(2));
    expect(result.current.assets[1].mediaUrl).toBeUndefined();
  });

  it("일부가 실패하면 incomplete로 남고 송출을 막지 않는다", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;
    const presentation = makePresentation([INITIAL_BACKGROUNDS[0].id]);

    const { result } = renderHook(() => useWorshipPrep(presentation));

    await waitFor(() => expect(result.current.phase).toBe("incomplete"));
    expect(result.current.isReady).toBe(false);
  });

  it("이미 캐시에 있으면 다시 받지 않고 곧바로 준비 완료다", async () => {
    const bg = INITIAL_BACKGROUNDS[0];
    const cache = await caches.open(MEDIA_CACHE_NAME);
    await cache.put(
      `/api/media/${bg.r2Key}`,
      new Response(new ArrayBuffer(8), { status: 200 }),
    );
    await cache.put(
      `/api/media/${bg.posterKey}`,
      new Response(new ArrayBuffer(8), { status: 200 }),
    );
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;

    const { result } = renderHook(() =>
      useWorshipPrep(makePresentation([bg.id])),
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("autoStart를 끄면 받지 않고 대기한다", async () => {
    const presentation = makePresentation([INITIAL_BACKGROUNDS[0].id]);
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;

    const { result } = renderHook(() =>
      useWorshipPrep(presentation, { autoStart: false }),
    );

    await waitFor(() => expect(result.current.phase).toBe("incomplete"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("start()로 다시 시도할 수 있다", async () => {
    const presentation = makePresentation([INITIAL_BACKGROUNDS[0].id]);
    const { result } = renderHook(() =>
      useWorshipPrep(presentation, { autoStart: false }),
    );
    await waitFor(() => expect(result.current.phase).toBe("incomplete"));

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });
});
