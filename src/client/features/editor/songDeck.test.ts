import { describe, it, expect } from "vitest";
import {
  createId,
  DEFAULT_DECK_STYLE,
  splitLyricsIntoSlides,
  type Slide,
} from "#shared";
import { createSongDeck } from "./songDeck";

const USER_ID = createId();
const LYRICS =
  "은혜로다 주의 은혜\n한량없는 주의 은혜\n\n나의 모든 것 주께 맡기며";

describe("createSongDeck", () => {
  it("제목과 아티스트의 앞뒤 공백을 걷어 내고 기본값으로 시작한다", () => {
    const deck = createSongDeck({
      userId: USER_ID,
      scope: "library",
      title: "  은혜로다 ",
      artist: " 손경민  ",
      lyricsRaw: LYRICS,
    });

    expect(deck.title).toBe("은혜로다");
    expect(deck.artist).toBe("손경민");
    expect(deck.userId).toBe(USER_ID);
    expect(deck.scope).toBe("library");
    expect(deck.presentationId).toBeNull();
    expect(deck.backgroundId).toBeNull();
    expect(deck.visibility).toBe("private");
    expect(deck.style).toEqual(DEFAULT_DECK_STYLE);
    expect(deck.createdAt).toBe(deck.updatedAt);
  });

  it("슬라이드를 주지 않으면 가사를 나눠 만들고, 주면 그대로 쓴다", () => {
    const generated = createSongDeck({
      userId: USER_ID,
      scope: "library",
      title: "은혜로다",
      lyricsRaw: LYRICS,
    });
    expect(generated.slides.map((slide) => slide.lines)).toEqual(
      splitLyricsIntoSlides(LYRICS).map((slide) => slide.lines),
    );
    expect(generated.artist).toBe("");

    const slides: Slide[] = splitLyricsIntoSlides(LYRICS);
    const given = createSongDeck({
      userId: USER_ID,
      scope: "presentation",
      title: "은혜로다",
      lyricsRaw: LYRICS,
      slides,
    });
    expect(given.slides).toEqual(slides);
  });

  it("origin을 주지 않으면 비워 두고, 주면 그 값을 쓴다", () => {
    const presentationDeck = createSongDeck({
      userId: USER_ID,
      scope: "presentation",
      title: "시선",
      lyricsRaw: LYRICS,
    });
    expect(presentationDeck.origin).toBeUndefined();
    expect("origin" in presentationDeck).toBe(false);

    const libraryDeck = createSongDeck({
      userId: USER_ID,
      scope: "library",
      title: "시선",
      lyricsRaw: LYRICS,
      origin: "user",
    });
    expect(libraryDeck.origin).toBe("user");
  });
});
