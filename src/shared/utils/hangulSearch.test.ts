import { describe, it, expect, vi } from "vitest";
import { convertQwertyToHangul, disassemble, getChoseong } from "es-hangul";
import {
  hangulIncludes,
  hangulIncludesPrepared,
  prepareHangulTarget,
} from "./hangulSearch";

vi.mock("es-hangul", async (importOriginal) => {
  const actual = await importOriginal<typeof import("es-hangul")>();
  return {
    ...actual,
    disassemble: vi.fn(actual.disassemble),
    getChoseong: vi.fn(actual.getChoseong),
    convertQwertyToHangul: vi.fn(actual.convertQwertyToHangul),
  };
});

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

describe("prepareHangulTarget", () => {
  const LYRICS = "한량없는 주의 은혜\n나의 모든 것";

  it("풀어 둔 대상은 검색어가 달라져도 다시 풀지 않는다", () => {
    const target = prepareHangulTarget(LYRICS);
    vi.mocked(disassemble).mockClear();
    vi.mocked(getChoseong).mockClear();

    const results = ["ㅎㄹㅇㄴ", "ㅈㅇ", "믿음", "wjd"].map((query) =>
      hangulIncludesPrepared(target, query),
    );

    expect(results).toEqual([true, true, false, false]);
    const targetText = target.lower;
    expect(
      vi.mocked(disassemble).mock.calls.filter(([text]) => text === targetText),
    ).toHaveLength(1);
    expect(
      vi.mocked(getChoseong).mock.calls.filter(([text]) => text === targetText),
    ).toHaveLength(1);
  });

  it("글자 그대로 들어 있으면 자모를 풀지 않는다", () => {
    const target = prepareHangulTarget(LYRICS);
    vi.mocked(disassemble).mockClear();
    vi.mocked(getChoseong).mockClear();

    expect(hangulIncludesPrepared(target, "주의 은혜")).toBe(true);

    expect(vi.mocked(getChoseong)).not.toHaveBeenCalled();
    expect(
      vi.mocked(disassemble).mock.calls.some(([text]) => text === target.lower),
    ).toBe(false);
  });

  it("같은 검색어로 여러 대상을 찾을 때 검색어는 한 번만 푼다", () => {
    const targets = Array.from({ length: 30 }, (_, i) =>
      prepareHangulTarget(`곡 ${i} 주의 은혜`),
    );
    const query = "믿음qz";
    vi.mocked(disassemble).mockClear();
    vi.mocked(convertQwertyToHangul).mockClear();

    const results = targets.map((target) =>
      hangulIncludesPrepared(target, query),
    );

    expect(results.every((found) => !found)).toBe(true);
    expect(vi.mocked(convertQwertyToHangul)).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(disassemble).mock.calls.filter(([text]) => text === query),
    ).toHaveLength(1);
  });

  it("검색어가 달라지면 새 검색어로 푼다", () => {
    const target = prepareHangulTarget(LYRICS);

    expect(hangulIncludesPrepared(target, "주의")).toBe(true);
    expect(hangulIncludesPrepared(target, "믿음")).toBe(false);
    expect(hangulIncludesPrepared(target, "ㅁㄷㄱ")).toBe(true);
    expect(hangulIncludesPrepared(target, "주의")).toBe(true);
  });

  it("영문 자판으로 친 검색어도 한글로 바꿔 찾는다", () => {
    const target = prepareHangulTarget("주의 은혜");

    expect(hangulIncludesPrepared(target, "wndml")).toBe(true);
    expect(hangulIncludesPrepared(target, "WNDML")).toBe(true);
    expect(hangulIncludesPrepared(target, "wndmlx")).toBe(false);
  });

  it("빈 대상은 어떤 검색어도 통과하지 못하고 빈 검색어는 모두 통과한다", () => {
    expect(hangulIncludesPrepared(prepareHangulTarget(null), "은혜")).toBe(
      false,
    );
    expect(hangulIncludesPrepared(prepareHangulTarget(""), "a")).toBe(false);
    expect(hangulIncludesPrepared(prepareHangulTarget(null), " ")).toBe(true);
  });
});
