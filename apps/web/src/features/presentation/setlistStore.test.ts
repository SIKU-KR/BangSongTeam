import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  DeckSchema,
  DEFAULT_DECK_STYLE,
  INITIAL_BACKGROUNDS,
} from "@repo/shared";
import {
  getActiveSetlist,
  addDeckToSetlist,
  resetActiveSetlist,
  useActiveSetlist,
  updateSetlistTitle,
  updateSongStyle,
  updateSongBackground,
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  reorderSongs,
  removeSongFromSetlist,
  duplicateSongInSetlist,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
} from "./setlistStore";

describe("setlistStore (In-memory reactive setlist)", () => {
  beforeEach(() => {
    resetActiveSetlist();
  });

  it("should initialize with the 5 mock songs", () => {
    const setlist = getActiveSetlist();
    expect(setlist.items).toHaveLength(5);
    expect(setlist.items[0].deck?.title).toBe("은혜로다");
  });

  it("should append a new deck to the setlist and assign a default background if missing", () => {
    const newDeck = DeckSchema.parse({
      id: "90000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000001",
      catalogId: null,
      scope: "setlist",
      setlistId: null,
      title: "아침 안개 눈 앞 가리듯",
      artist: "CCM",
      lyricsRaw: "아침 안개 눈 앞 가리듯",
      slides: [
        {
          id: "slide-1",
          order: 0,
          lines: ["아침 안개 눈 앞 가리듯"],
        },
      ],
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });

    const item = addDeckToSetlist(newDeck);
    expect(item.order).toBe(5);
    expect(item.deck?.title).toBe("아침 안개 눈 앞 가리듯");
    // Should automatically assign a valid background from INITIAL_BACKGROUNDS
    expect(item.deck?.backgroundId).toBe(
      INITIAL_BACKGROUNDS[5 % INITIAL_BACKGROUNDS.length].id,
    );

    const updated = getActiveSetlist();
    expect(updated.items).toHaveLength(6);
  });

  it("should notify useActiveSetlist hook subscribers on addDeckToSetlist", () => {
    const { result } = renderHook(() => useActiveSetlist());
    expect(result.current.items).toHaveLength(5);

    const newDeck = DeckSchema.parse({
      id: "90000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000001",
      catalogId: null,
      scope: "setlist",
      setlistId: null,
      title: "새 노래로",
      artist: "찬양",
      lyricsRaw: "새 노래로 주 찬양해",
      slides: [
        {
          id: "s-1",
          order: 0,
          lines: ["새 노래로 주 찬양해"],
        },
      ],
      backgroundId: INITIAL_BACKGROUNDS[2].id,
      style: DEFAULT_DECK_STYLE,
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });

    act(() => {
      addDeckToSetlist(newDeck);
    });

    expect(result.current.items).toHaveLength(6);
    expect(result.current.items[5].deck?.title).toBe("새 노래로");
    expect(result.current.items[5].deck?.backgroundId).toBe(
      INITIAL_BACKGROUNDS[2].id,
    );
  });

  it("should update setlist title and notify subscribers", () => {
    const { result } = renderHook(() => useActiveSetlist());
    act(() => {
      updateSetlistTitle("2026 청년부 금요 찬양");
    });
    expect(result.current.title).toBe("2026 청년부 금요 찬양");
  });

  it("should update song style and background", () => {
    const { result } = renderHook(() => useActiveSetlist());
    act(() => {
      updateSongStyle(0, {
        overlayOpacity: 70,
        fontFamily: "Noto Sans KR",
        position: {
          anchor: "bottom-center",
          xPercent: 50,
          yPercent: 90,
          widthPercent: 85,
        },
      });
      updateSongBackground(0, INITIAL_BACKGROUNDS[3].id);
    });

    const song = result.current.items[0].deck;
    expect(song?.style.overlayOpacity).toBe(70);
    expect(song?.style.fontFamily).toBe("Noto Sans KR");
    expect(song?.style.position.anchor).toBe("bottom-center");
    expect(song?.backgroundId).toBe(INITIAL_BACKGROUNDS[3].id);
  });

  it("should manage slides (update, add, duplicate, remove)", () => {
    const { result } = renderHook(() => useActiveSetlist());
    const initialSlideCount = result.current.items[0].deck?.slides.length ?? 0;

    // Update lines
    act(() => {
      updateSlideLines(0, 0, ["첫 번째 줄 수정", "두 번째 줄 수정"]);
    });
    expect(result.current.items[0].deck?.slides[0].lines).toEqual([
      "첫 번째 줄 수정",
      "두 번째 줄 수정",
    ]);

    // Add slide
    act(() => {
      addSlideToSong(0, ["새로운 슬라이드"], 0);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 1,
    );
    expect(result.current.items[0].deck?.slides[1].lines).toEqual([
      "새로운 슬라이드",
    ]);

    // Duplicate slide
    act(() => {
      duplicateSlide(0, 1);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 2,
    );
    expect(result.current.items[0].deck?.slides[2].lines).toEqual([
      "새로운 슬라이드",
    ]);

    // Remove slide
    act(() => {
      removeSlideFromSong(0, 2);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 1,
    );
  });

  it("should reorder and remove songs", () => {
    const { result } = renderHook(() => useActiveSetlist());
    const firstSongTitle = result.current.items[0].deck?.title;
    const secondSongTitle = result.current.items[1].deck?.title;

    act(() => {
      reorderSongs(0, 1);
    });
    expect(result.current.items[0].deck?.title).toBe(secondSongTitle);
    expect(result.current.items[1].deck?.title).toBe(firstSongTitle);

    act(() => {
      removeSongFromSetlist(0);
    });
    expect(result.current.items).toHaveLength(4);
    expect(result.current.items[0].deck?.title).toBe(firstSongTitle);
  });

  it("should duplicate a song within setlist", () => {
    const { result } = renderHook(() => useActiveSetlist());
    const initialSongCount = result.current.items.length;

    act(() => {
      duplicateSongInSetlist(0);
    });

    expect(result.current.items).toHaveLength(initialSongCount + 1);
    expect(result.current.items[1].deck?.title).toBe("은혜로다 (사본)");
    expect(result.current.items[1].deck?.slides).toHaveLength(
      result.current.items[0].deck?.slides.length ?? 0,
    );
  });

  it("should reorder slides within a song", () => {
    const { result } = renderHook(() => useActiveSetlist());
    const originalSlide0 = result.current.items[0].deck?.slides[0].lines[0];
    const originalSlide1 = result.current.items[0].deck?.slides[1].lines[0];

    act(() => {
      reorderSlides(0, 0, 1);
    });

    expect(result.current.items[0].deck?.slides[0].lines[0]).toBe(
      originalSlide1,
    );
    expect(result.current.items[0].deck?.slides[1].lines[0]).toBe(
      originalSlide0,
    );
  });

  it("should support undo and redo", () => {
    const { result } = renderHook(() => useActiveSetlist());
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);

    // Make an edit
    act(() => {
      updateSetlistTitle("수정된 제목");
    });
    expect(result.current.title).toBe("수정된 제목");
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);

    // Undo edit
    act(() => {
      undo();
    });
    expect(result.current.title).toBe("2026 주일 3부 예배");
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);

    // Redo edit
    act(() => {
      redo();
    });
    expect(result.current.title).toBe("수정된 제목");
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });
});
