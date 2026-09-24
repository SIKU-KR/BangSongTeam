import { describe, it, expect } from "vitest";
import {
  collectPresentationMediaAssets,
  collectUniqueMediaUrls,
  collectPresentationFonts,
} from "./offlineAssets";
import { DEFAULT_DECK_STYLE } from "../constants";
import type { Presentation, PresentationItem } from "../schemas/presentation";
import type { Deck } from "../schemas/deck";
import type { BackgroundMedia } from "../schemas/media";

const USER_ID = "00000000x000000000001";
const PRESENTATION_ID = "100000000000000000001";
const NOW = "2026-09-22T00:00:00.000Z";

function makeBackground(
  index: number,
  overrides: Partial<BackgroundMedia> = {},
): BackgroundMedia {
  return {
    id: `b000000000000000000${index}0`,
    title: `배경 ${index}`,
    source: "service",
    kind: "video",
    mediaUrl: `/api/media/loops/${index}.mp4`,
    posterUrl: `/api/media/posters/${index}.webp`,
    durationSec: 20,
    sizeBytes: 1000,
    license: "CC0",
    tags: [],
    createdAt: NOW,
    ...overrides,
  };
}

const BACKGROUNDS = [makeBackground(1), makeBackground(2)];
const IMAGE_BACKGROUND = makeBackground(3, {
  kind: "image",
  mediaUrl: "/api/media/uploads/u/3.png",
  posterUrl: "/api/media/uploads/u/3.png",
});
const CATALOG = [...BACKGROUNDS, IMAGE_BACKGROUND];
const findBackground = (id: string): BackgroundMedia | undefined =>
  CATALOG.find((bg) => bg.id === id);

function collect(presentation: Presentation) {
  return collectPresentationMediaAssets(presentation, findBackground);
}

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
    backgroundId: BACKGROUNDS[0].id,
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
    const bg = BACKGROUNDS[1];
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: bg.id, title: "은혜로다" }),
    ]);

    const [asset] = collect(presentation);

    expect(asset.songIndex).toBe(0);
    expect(asset.songTitle).toBe("은혜로다");
    expect(asset.backgroundTitle).toBe(bg.title);
    expect(asset.mediaUrl).toBe(bg.mediaUrl);
    expect(asset.posterUrl).toBe(bg.posterUrl);
  });

  it("order가 뒤섞여 있어도 순서대로 정렬한다", () => {
    const presentation = makePresentation([
      makeDeck(1, { title: "첫째" }),
      makeDeck(2, { title: "둘째" }),
    ]);
    presentation.items[0].order = 1;
    presentation.items[1].order = 0;

    const assets = collect(presentation);

    expect(assets.map((a) => a.songTitle)).toEqual(["둘째", "첫째"]);
    expect(assets.map((a) => a.songIndex)).toEqual([0, 1]);
  });

  it("배경이 없는 곡도 목록에서 빠뜨리지 않는다", () => {
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: null, title: "배경 없는 곡" }),
    ]);

    const [asset] = collect(presentation);

    expect(asset.songTitle).toBe("배경 없는 곡");
    expect(asset.backgroundId).toBeNull();
    expect(asset.mediaUrl).toBeUndefined();
  });

  it("이미지 배경은 원본 이미지 하나만 받는다", () => {
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: IMAGE_BACKGROUND.id }),
    ]);

    expect(collectUniqueMediaUrls(collect(presentation))).toEqual([
      IMAGE_BACKGROUND.mediaUrl,
    ]);
  });

  it("알 수 없는 배경 id는 URL 없이 표시만 남긴다", () => {
    const unknown = "b99999999999999999999";
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: unknown }),
    ]);

    const [asset] = collect(presentation);

    expect(asset.backgroundId).toBe(unknown);
    expect(asset.backgroundTitle).toBeNull();
    expect(asset.mediaUrl).toBeUndefined();
  });

  it("덱이 아직 붙지 않은 항목도 자리를 지킨다", () => {
    const presentation = makePresentation([undefined]);

    const [asset] = collect(presentation);

    expect(asset.songTitle).toBe("(제목 없음)");
    expect(asset.mediaUrl).toBeUndefined();
  });
});

describe("collectUniqueMediaUrls", () => {
  it("여러 곡이 같은 배경을 써도 한 번만 받는다", () => {
    const bg = BACKGROUNDS[0];
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: bg.id }),
      makeDeck(2, { backgroundId: bg.id }),
      makeDeck(3, { backgroundId: bg.id }),
    ]);

    const urls = collectUniqueMediaUrls(collect(presentation));

    expect(urls).toEqual([bg.mediaUrl, bg.posterUrl]);
  });

  it("서로 다른 배경은 모두 받는다", () => {
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: BACKGROUNDS[0].id }),
      makeDeck(2, { backgroundId: BACKGROUNDS[1].id }),
    ]);

    const urls = collectUniqueMediaUrls(collect(presentation));

    expect(urls).toHaveLength(4);
    expect(new Set(urls).size).toBe(4);
  });

  it("배경이 없으면 받을 것이 없다", () => {
    const presentation = makePresentation([
      makeDeck(1, { backgroundId: null }),
    ]);

    expect(collectUniqueMediaUrls(collect(presentation))).toEqual([]);
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
