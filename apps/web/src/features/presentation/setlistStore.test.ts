import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DeckSchema, DEFAULT_DECK_STYLE, INITIAL_BACKGROUNDS } from "@repo/shared";
import {
  getActiveSetlist,
  addDeckToSetlist,
  resetActiveSetlist,
  useActiveSetlist,
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
    expect(item.deck?.backgroundId).toBe(INITIAL_BACKGROUNDS[5 % INITIAL_BACKGROUNDS.length].id);

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
    expect(result.current.items[5].deck?.backgroundId).toBe(INITIAL_BACKGROUNDS[2].id);
  });
});
