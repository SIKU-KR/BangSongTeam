import { describe, it, expect } from "vitest";
import { DEFAULT_DECK_STYLE, type Deck, type PublicDeckSummary } from "#shared";
import { EDITOR_COPY } from "#copy/editor";
import { buildPickerEntries, getPickerEmptyMessage } from "./pickerEntries";

const NOW = "2026-01-01T00:00:00.000Z";

function makeDeck(id: string, overrides: Partial<Deck> = {}): Deck {
  return {
    id,
    userId: "user-1",
    scope: "library",
    presentationId: null,
    title: `곡 ${id}`,
    artist: "",
    lyricsRaw: "",
    slides: [],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSummary(
  id: string,
  overrides: Partial<PublicDeckSummary> = {},
): PublicDeckSummary {
  return {
    id,
    title: `공유 ${id}`,
    artist: "",
    authorName: "김찬양",
    forkedFromAuthorName: null,
    forkCount: 0,
    backgroundId: null,
    firstSlidePreview: [],
    slideCount: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

const GRACE = makeDeck("grace", { title: "은혜로다", artist: "손경민" });
const GAZE = makeDeck("gaze", { title: "시선", lyricsRaw: "주님의 시선" });

describe("buildPickerEntries", () => {
  it("내 곡을 먼저, 공유 곡을 뒤에 두고 접두어 붙은 key를 준다", () => {
    const entries = buildPickerEntries({
      mySongs: [GRACE, GAZE],
      sharedDecks: [makeSummary("s1")],
      query: "",
      filter: "all",
    });
    expect(entries.map((entry) => entry.key)).toEqual([
      "mine:grace",
      "mine:gaze",
      "shared:s1",
    ]);
  });

  it("검색어 앞뒤 공백을 무시하고 내 곡을 제목·아티스트·가사로 거른다", () => {
    const keys = (query: string): string[] =>
      buildPickerEntries({
        mySongs: [GRACE, GAZE],
        sharedDecks: [],
        query,
        filter: "all",
      }).map((entry) => entry.key);
    expect(keys("  손경민 ")).toEqual(["mine:grace"]);
    expect(keys("주님의")).toEqual(["mine:gaze"]);
    expect(keys("   ")).toEqual(["mine:grace", "mine:gaze"]);
  });

  it("내가 공개한 곡은 공유 결과에서 빼고, 가져온 사본은 ownedCopy로 잇는다", () => {
    const fork = makeDeck("fork", { origin: "fork", forkedFrom: "s2" });
    const entries = buildPickerEntries({
      mySongs: [GRACE, fork],
      sharedDecks: [makeSummary("grace"), makeSummary("s2")],
      query: "",
      filter: "shared",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "shared", key: "shared:s2" });
    expect(entries[0].kind === "shared" && entries[0].ownedCopy).toBe(fork);
  });

  it("필터가 mine이면 내 곡만 남긴다", () => {
    const entries = buildPickerEntries({
      mySongs: [GRACE],
      sharedDecks: [makeSummary("s1")],
      query: "",
      filter: "mine",
    });
    expect(entries.map((entry) => entry.key)).toEqual(["mine:grace"]);
  });
});

describe("getPickerEmptyMessage", () => {
  it("검색 중이면 검색 중 안내를 가장 먼저 보여 준다", () => {
    expect(
      getPickerEmptyMessage({
        isFetching: true,
        query: "은혜",
        filter: "mine",
      }),
    ).toBe(EDITOR_COPY.picker.searching);
  });

  it("검색어가 있으면 필터와 상관없이 일치 없음 안내를 보여 준다", () => {
    expect(
      getPickerEmptyMessage({
        isFetching: false,
        query: "은혜",
        filter: "shared",
      }),
    ).toBe(EDITOR_COPY.picker.noMatch);
  });

  it("검색어가 없으면 필터에 맞는 빈 목록 안내를 보여 준다", () => {
    const message = (filter: "all" | "mine" | "shared"): string =>
      getPickerEmptyMessage({ isFetching: false, query: " ", filter });
    expect(message("shared")).toBe(EDITOR_COPY.picker.noShared);
    expect(message("mine")).toBe(EDITOR_COPY.picker.noMine);
    expect(message("all")).toBe(EDITOR_COPY.picker.noSongs);
  });
});
