import { describe, it, expect } from "vitest";
import { DEFAULT_DECK_STYLE, DEFAULT_PRESET_FONTS } from "#shared";
import type { NoonnuFont } from "#shared";
import {
  excludePresetFonts,
  ptToVw,
  searchFonts,
  stepFontSize,
  vwToPt,
} from "./ribbonOptions";

describe("글자 크기 pt 변환", () => {
  it("기본 크기 4.2vw는 40pt로 보인다", () => {
    expect(vwToPt(DEFAULT_DECK_STYLE.fontSizeVw)).toBe(40);
  });

  it("pt를 스키마 범위(2–10vw) 안의 vw로 바꾼다", () => {
    expect(ptToVw(60)).toBe(6.25);
    expect(ptToVw(96)).toBe(10);
    expect(ptToVw(200)).toBe(10);
    expect(ptToVw(5)).toBe(2);
  });

  it("목록의 다음·이전 칸으로 옮기고 끝에서는 멈춘다", () => {
    expect(vwToPt(stepFontSize(DEFAULT_DECK_STYLE.fontSizeVw, 1))).toBe(44);
    expect(vwToPt(stepFontSize(DEFAULT_DECK_STYLE.fontSizeVw, -1))).toBe(36);
    expect(vwToPt(stepFontSize(ptToVw(40), 1))).toBe(44);
    expect(vwToPt(stepFontSize(ptToVw(42), 1))).toBe(44);
    expect(stepFontSize(10, 1)).toBe(10);
    expect(vwToPt(stepFontSize(2, -1))).toBe(19);
  });
});

const font = (
  id: string,
  name: string,
  author = "",
  cardFamily = name,
): NoonnuFont => ({ id, name, author, cardFamily, url: `https://x/${id}` });

describe("글꼴 검색", () => {
  const catalog = [
    font("core-pretendard", "Pretendard", "길형진"),
    font("1", "고운바탕", "류양희", "GowunBatang-Regular"),
    font("2", "페이퍼로지", "이주임", "Paperlogy-8ExtraBold"),
    font("3", "고운돋움", "류양희", "GowunDodum-Regular"),
  ];

  it("이름·제작자·카드 패밀리명을 대소문자 구분 없이 찾는다", () => {
    expect(searchFonts(catalog, "페이퍼", 60).map((f) => f.id)).toEqual(["2"]);
    expect(searchFonts(catalog, "류양희", 60).map((f) => f.id)).toEqual([
      "1",
      "3",
    ]);
    expect(searchFonts(catalog, "  gowunbatang ", 60).map((f) => f.id)).toEqual(
      ["1"],
    );
  });

  it("기본 글꼴도 검색 결과에 들어간다", () => {
    expect(searchFonts(catalog, "pretendard", 60).map((f) => f.id)).toEqual([
      "core-pretendard",
    ]);
  });

  it("결과를 개수 제한만큼 자른다", () => {
    expect(searchFonts(catalog, "고운", 1).map((f) => f.id)).toEqual(["1"]);
  });
});

describe("기본 글꼴 제외", () => {
  it("기본 글꼴 이름을 뺀 나머지를 순서대로 남긴다", () => {
    const catalog = [
      ...DEFAULT_PRESET_FONTS.map((name, i) => font(`core-${i}`, name)),
      font("1", "고운바탕"),
      font("2", "페이퍼로지"),
    ];
    expect(excludePresetFonts(catalog).map((f) => f.id)).toEqual(["1", "2"]);
  });
});
