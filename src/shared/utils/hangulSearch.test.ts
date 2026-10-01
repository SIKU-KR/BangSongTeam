import { describe, it, expect } from "vitest";
import { deckMatchesQuery, hangulIncludes } from "./hangulSearch";

describe("hangulIncludes (es-hangul search)", () => {
  it("should match standard substrings case-insensitively", () => {
    expect(hangulIncludes("은혜로다", "은혜")).toBe(true);
    expect(hangulIncludes("Grace to Grace", "grace")).toBe(true);
    expect(hangulIncludes("은혜로다", "믿음")).toBe(false);
  });

  it("should match Korean choseong (초성 검색)", () => {
    expect(hangulIncludes("은혜로다", "ㅇㅎ")).toBe(true);
    expect(hangulIncludes("은혜로다", "ㅇㅎㄹㄷ")).toBe(true);
    expect(hangulIncludes("시선", "ㅅㅅ")).toBe(true);
    expect(hangulIncludes("꽃들도", "ㄲㄷㄷ")).toBe(true);
    expect(hangulIncludes("손경민", "ㅅㄱㅁ")).toBe(true);
  });

  it("should match choseong with or without spaces", () => {
    expect(hangulIncludes("시간을 뚫고", "ㅅㄱㅇ ㄸㄱ")).toBe(true);
    expect(hangulIncludes("시간을 뚫고", "ㅅㄱㅇㄸㄱ")).toBe(true);
  });

  it("should match disassembled partial syllables (미완성 자모 실시간 검색)", () => {
    expect(hangulIncludes("은혜로다", "은ㅎ")).toBe(true);
    expect(hangulIncludes("시선", "시ㅅ")).toBe(true);
  });

  it("should handle empty or null targets safely", () => {
    expect(hangulIncludes(null, "은혜")).toBe(false);
    expect(hangulIncludes(undefined, "은혜")).toBe(false);
    expect(hangulIncludes("은혜로다", "")).toBe(true);
    expect(hangulIncludes("은혜로다", "   ")).toBe(true);
  });
});

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
