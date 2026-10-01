import { describe, it, expect } from "vitest";
import { deckMatchesQuery } from "./deckSearch";

describe("deckMatchesQuery", () => {
  const deck = {
    title: "은혜로다",
    artist: "손경민",
    lyricsRaw: "한량없는 주의 은혜\n나의 모든 것",
  };

  it("제목·아티스트·가사 중 하나라도 맞으면 통과한다", () => {
    expect(deckMatchesQuery(deck, "ㅇㅎ")).toBe(true);
    expect(deckMatchesQuery(deck, "손경민")).toBe(true);
    expect(deckMatchesQuery(deck, "한량없는")).toBe(true);
  });

  it("어디에도 없는 검색어는 통과하지 못한다", () => {
    expect(deckMatchesQuery(deck, "시선")).toBe(false);
  });

  it("아티스트가 비어 있어도 다른 필드로 찾는다", () => {
    expect(deckMatchesQuery({ ...deck, artist: "" }, "은혜")).toBe(true);
    expect(deckMatchesQuery({ ...deck, artist: "" }, "손경민")).toBe(false);
  });
});
