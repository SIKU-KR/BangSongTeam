import { describe, it, expect } from "vitest";
import { hangulIncludes } from "./hangulSearch";

describe("hangulIncludes (es-hangul search)", () => {
  it("should match standard substrings case-insensitively", () => {
    expect(hangulIncludes("은혜로다", "은혜")).toBe(true);
    expect(hangulIncludes("Grace to Grace", "grace")).toBe(true);
    expect(hangulIncludes("은혜로다", "믿음")).toBe(false);
  });

  it("should match Korean choseong (초성 검색)", () => {
    // 'ㅇㅎㄹㄷ' -> '은혜로다'
    expect(hangulIncludes("은혜로다", "ㅇㅎ")).toBe(true);
    expect(hangulIncludes("은혜로다", "ㅇㅎㄹㄷ")).toBe(true);

    // 'ㅅㅅ' -> '시선'
    expect(hangulIncludes("시선", "ㅅㅅ")).toBe(true);

    // 'ㄲㄷㄷ' -> '꽃들도'
    expect(hangulIncludes("꽃들도", "ㄲㄷㄷ")).toBe(true);

    // 'ㅅㄱㅁ' -> '손경민'
    expect(hangulIncludes("손경민", "ㅅㄱㅁ")).toBe(true);
  });

  it("should match choseong with or without spaces", () => {
    // '시간을 뚫고' vs 'ㅅㄱㅇ ㄸㄱ' and 'ㅅㄱㅇㄸㄱ'
    expect(hangulIncludes("시간을 뚫고", "ㅅㄱㅇ ㄸㄱ")).toBe(true);
    expect(hangulIncludes("시간을 뚫고", "ㅅㄱㅇㄸㄱ")).toBe(true);
  });

  it("should match disassembled partial syllables (미완성 자모 실시간 검색)", () => {
    // '은ㅎ' -> '은혜'
    expect(hangulIncludes("은혜로다", "은ㅎ")).toBe(true);
    // '시ㅅ' -> '시선'
    expect(hangulIncludes("시선", "시ㅅ")).toBe(true);
  });

  it("should handle empty or null targets safely", () => {
    expect(hangulIncludes(null, "은혜")).toBe(false);
    expect(hangulIncludes(undefined, "은혜")).toBe(false);
    expect(hangulIncludes("은혜로다", "")).toBe(true);
    expect(hangulIncludes("은혜로다", "   ")).toBe(true);
  });
});
