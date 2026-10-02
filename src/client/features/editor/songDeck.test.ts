import { describe, it, expect } from "vitest";
import { createId, DEFAULT_DECK_STYLE, splitLyricsIntoSlides } from "#shared";
import { createSongDeck } from "./songDeck";

const USER_ID = createId();
const LYRICS =
  "은혜로다 주의 은혜\n한량없는 주의 은혜\n\n나의 모든 것 주께 맡기며";

describe("createSongDeck", () => {
  it("제목과 아티스트의 앞뒤 공백을 걷어 내고 기본값으로 시작한다", () => {
    const deck = createSongDeck({
      userId: USER_ID,
      title: "  은혜로다 ",
      artist: " 손경민  ",
      lyricsRaw: LYRICS,
    });

    expect(deck.title).toBe("은혜로다");
    expect(deck.artist).toBe("손경민");
    expect(deck.userId).toBe(USER_ID);
    expect(deck.scope).toBe("library");
    expect(deck.origin).toBe("user");
    expect(deck.presentationId).toBeNull();
    expect(deck.backgroundId).toBeNull();
    expect(deck.visibility).toBe("private");
    expect(deck.style).toEqual(DEFAULT_DECK_STYLE);
    expect(deck.createdAt).toBe(deck.updatedAt);
  });

  it("가사를 나눠 슬라이드를 만들고, 아티스트가 없으면 비워 둔다", () => {
    const deck = createSongDeck({
      userId: USER_ID,
      title: "은혜로다",
      lyricsRaw: LYRICS,
    });
    expect(deck.slides.map((slide) => slide.lines)).toEqual(
      splitLyricsIntoSlides(LYRICS).map((slide) => slide.lines),
    );
    expect(deck.artist).toBe("");
  });
});
