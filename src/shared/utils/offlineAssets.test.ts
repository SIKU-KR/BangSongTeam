import { describe, it, expect } from "vitest";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  collectPresentationFonts,
} from "./offlineAssets";
import { INITIAL_BACKGROUNDS } from "../constants/backgrounds";
import { DEFAULT_DECK_STYLE } from "../constants";
import type { Presentation, PresentationItem } from "../schemas/presentation";
import type { Deck } from "../schemas/deck";

const USER_ID = "00000000x000000000001";
const PRESENTATION_ID = "100000000000000000001";
const NOW = "2026-09-22T00:00:00.000Z";

function makeDeck(index: number, overrides: Partial<Deck> = {}): Deck {
  return {
    id: `20000000000000000000${index}`,
    userId: USER_ID,
    scope: "presentation",
    presentationId: PRESENTATION_ID,
    title: `곡 ${index}`,
    artist: "",
    lyricsRaw: "가사",
    slides: [{ id: `s${index}`, order: 0, lines: ["가사"] }],
    backgroundId: INITIAL_BACKGROUNDS[0].id,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Deck;
}

function makePresentation(decks: (Deck | undefined)[]): Presentation {
  const items: PresentationItem[] = decks.map((deck, index) => ({
    id: `30000000000000000000${index + 1}`,
    presentationId: PRESENTATION_ID,
    deckId: deck?.id ?? `20000000000000000009${index}`,
    order: index,
    deck,
  }));

  return {
    id: PRESENTATION_ID,
    userId: USER_ID,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    items,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("collectPresentationMediaAssets", () => {
  it("곡 순서대로 배경 영상·포스터 URL을 만든다", () => {
    const bg = INITIAL_BACKGROUNDS[1];
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: bg.id, title: "은혜로다" }),
    ]);

    const [asset] = collectPresentationMediaAssets(presentation);

    expect(asset.songIndex).toBe(0);
    expect(asset.songTitle).toBe("은혜로다");
    expect(asset.backgroundTitle).toBe(bg.title);
    expect(asset.mediaUrl).toBe(`/api/media/${bg.r2Key}`);
    expect(asset.posterUrl).toBe(`/api/media/${bg.posterKey}`);
  });

  it("order가 뒤섞여 있어도 순서대로 정렬한다", () => {
    const presentation = makePresentation([
      makeDeck(1, { title: "첫째" }),
      makeDeck(2, { title: "둘째" }),
    ]);
    presentation.items[0].order = 1;
    presentation.items[1].order = 0;

    const assets = collectPresentationMediaAssets(presentation);

    expect(assets.map((a) => a.songTitle)).toEqual(["둘째", "첫째"]);
    expect(assets.map((a) => a.songIndex)).toEqual([0, 1]);
  });

  it("배경이 없는 곡도 목록에서 빠뜨리지 않는다", () => {
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: null, title: "배경 없는 곡" }),
    ]);

    const [asset] = collectPresentationMediaAssets(presentation);

    expect(asset.songTitle).toBe("배경 없는 곡");
    expect(asset.backgroundId).toBeNull();
    expect(asset.mediaUrl).toBeUndefined();
  });

  it("알 수 없는 배경 id는 URL 없이 표시만 남긴다", () => {
    const unknown = "b99999999999999999999";
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: unknown }),
    ]);

    const [asset] = collectPresentationMediaAssets(presentation);

    expect(asset.backgroundId).toBe(unknown);
    expect(asset.backgroundTitle).toBeNull();
    expect(asset.mediaUrl).toBeUndefined();
  });

  it("덱이 아직 붙지 않은 항목도 자리를 지킨다", () => {
    const presentation = makePresentation([undefined]);

    const [asset] = collectPresentationMediaAssets(presentation);

    expect(asset.songTitle).toBe("(제목 없음)");
    expect(asset.mediaUrl).toBeUndefined();
  });
});

describe("collectUniqueMediaUrls", () => {
  it("여러 곡이 같은 배경을 써도 한 번만 받는다", () => {
    const bg = INITIAL_BACKGROUNDS[0];
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: bg.id }),
      makeDeck(2, { backgroundId: bg.id }),
      makeDeck(3, { backgroundId: bg.id }),
    ]);

    const urls = collectUniqueMediaUrls(
      collectPresentationMediaAssets(presentation),
    );

    expect(urls).toEqual([
      `/api/media/${bg.r2Key}`,
      `/api/media/${bg.posterKey}`,
    ]);
  });

  it("서로 다른 배경은 모두 받는다", () => {
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: INITIAL_BACKGROUNDS[0].id }),
      makeDeck(2, { backgroundId: INITIAL_BACKGROUNDS[1].id }),
    ]);

    const urls = collectUniqueMediaUrls(
      collectPresentationMediaAssets(presentation),
    );

    expect(urls).toHaveLength(4);
    expect(new Set(urls).size).toBe(4);
  });

  it("배경이 없으면 받을 것이 없다", () => {
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: null }),
    ]);

    expect(
      collectUniqueMediaUrls(collectPresentationMediaAssets(presentation)),
    ).toEqual([]);
  });
});

describe("collectPresentationFonts", () => {
  it("세트가 쓰는 글꼴만 중복 없이 돌려준다", () => {
    const presentation = makePresentation([
      makeDeck(1, {
        style: { ...DEFAULT_DECK_STYLE, fontFamily: "Pretendard" },
      }),
      makeDeck(2, {
        style: { ...DEFAULT_DECK_STYLE, fontFamily: "Noto Sans KR" },
      }),
      makeDeck(3, {
        style: { ...DEFAULT_DECK_STYLE, fontFamily: "Pretendard" },
      }),
    ]);

    expect(collectPresentationFonts(presentation)).toEqual([
      "Pretendard",
      "Noto Sans KR",
    ]);
  });
});
