import { describe, it, expect } from "vitest";
import { FALLBACK_USER_NAME, UNTITLED_SONG } from "../copy/app";
import { MAX_DECK_TITLE_LENGTH } from "../schemas/deck";
import {
  clampText,
  fitDeckText,
  toDisplayName,
  toNonNegativeInt,
} from "./fitToLimits";

describe("clampText", () => {
  it("한도 안의 글은 그대로 둔다", () => {
    expect(clampText("은혜로다", 100)).toBe("은혜로다");
    expect(clampText("가".repeat(100), 100)).toBe("가".repeat(100));
  });

  it("한도를 넘으면 UTF-16 단위로 잘라 한도에 맞춘다", () => {
    expect(clampText("가".repeat(153), MAX_DECK_TITLE_LENGTH)).toBe(
      "가".repeat(100),
    );
  });

  it("서로게이트 쌍을 반쪽으로 자르지 않는다", () => {
    const clamped = clampText(`${"가".repeat(99)}😀`, 100);

    expect(clamped).toBe("가".repeat(99));
    expect(clamped).toHaveLength(99);
  });
});

describe("toDisplayName", () => {
  it("문자열이 아니거나 비어 있으면 기본 이름을 쓴다", () => {
    for (const raw of [0, null, undefined, { x: 1 }, "", "   "]) {
      expect(toDisplayName(raw)).toBe(FALLBACK_USER_NAME.default);
    }
  });

  it("앞뒤 공백을 떼고 50자로 줄인다", () => {
    expect(toDisplayName("  a  ")).toBe("a");
    expect(toDisplayName("a".repeat(200))).toBe("a".repeat(50));
    expect(toDisplayName("김찬양")).toBe("김찬양");
  });

  it("채움 문자나 폭 없는 문자처럼 보이지 않는 글자뿐이면 기본 이름을 쓴다", () => {
    for (const raw of [
      "\u3164",
      "\u200B",
      "\u115F\u200B",
      "\u1160\uFFA0",
      "\u2060\uFE0F\u2800",
      " \u3164 \u200D ",
    ]) {
      expect(toDisplayName(raw)).toBe(FALLBACK_USER_NAME.default);
    }
  });

  it("뒤따르는 글의 방향을 바꾸는 제어 문자를 뺀다", () => {
    expect(toDisplayName("\u202E관리자")).toBe("관리자");
    expect(toDisplayName("김\u2067찬양\u2069")).toBe("김찬양");
    expect(toDisplayName("\u202E \u2066")).toBe(FALLBACK_USER_NAME.default);
  });

  it("보이는 글자와 함께 있는 이모지 결합 문자는 그대로 둔다", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";

    expect(toDisplayName(`찬양팀 ${family}`)).toBe(`찬양팀 ${family}`);
    expect(toDisplayName("\u200B김찬양")).toBe("\u200B김찬양");
  });

  it("50자로 줄인 뒤 보이는 글자가 남지 않으면 기본 이름을 쓴다", () => {
    expect(toDisplayName(`${"\u3164".repeat(50)}김`)).toBe(
      FALLBACK_USER_NAME.default,
    );
  });
});

describe("fitDeckText", () => {
  it("제목·아티스트·원작자 이름을 스키마 한도로 줄인다", () => {
    expect(
      fitDeckText({
        title: "가".repeat(153),
        artist: "나".repeat(150),
        forkedFromAuthorName: "x".repeat(150),
      }),
    ).toEqual({
      title: "가".repeat(100),
      artist: "나".repeat(100),
      forkedFromAuthorName: "x".repeat(100),
    });
  });

  it("빈 제목이나 문자열이 아닌 값에는 기본값을 쓴다", () => {
    expect(fitDeckText({ title: "", artist: null })).toEqual({
      title: UNTITLED_SONG,
      artist: "",
      forkedFromAuthorName: null,
    });
    expect(
      fitDeckText({ title: 42, artist: 7, forkedFromAuthorName: 12345 }),
    ).toEqual({
      title: UNTITLED_SONG,
      artist: "",
      forkedFromAuthorName: FALLBACK_USER_NAME.default,
    });
  });

  it("원작자 이름이 없으면 키를 빼지 않고 null로 둔다", () => {
    const withoutAuthor = fitDeckText({ title: "은혜로다", artist: "" });
    expect(withoutAuthor).toHaveProperty("forkedFromAuthorName", null);
    expect(
      fitDeckText({
        title: "은혜로다",
        artist: "",
        forkedFromAuthorName: null,
      }).forkedFromAuthorName,
    ).toBeNull();
  });

  it("한도 안의 값은 그대로 돌려준다", () => {
    expect(
      fitDeckText({
        title: "은혜로다",
        artist: "예수전도단",
        forkedFromAuthorName: "김찬양",
      }),
    ).toEqual({
      title: "은혜로다",
      artist: "예수전도단",
      forkedFromAuthorName: "김찬양",
    });
  });
});

describe("toNonNegativeInt", () => {
  it("0 이상의 안전한 정수만 그대로 두고 나머지는 0으로 읽는다", () => {
    for (const value of [NaN, -1, 2.5, "3", undefined, null, 2 ** 53]) {
      expect(toNonNegativeInt(value)).toBe(0);
    }
    expect(toNonNegativeInt(4)).toBe(4);
    expect(toNonNegativeInt(0)).toBe(0);
  });
});
