import { describe, expect, it } from "vitest";
import { FALLBACK_USER_NAME, OFFICIAL_LIBRARY_NAME } from "#shared";
import { isReservedUserName, toAccountName } from "./userNames";

describe("공식 라이브러리 이름", () => {
  it.each([
    OFFICIAL_LIBRARY_NAME,
    " 공식찬양라이브러리 ",
    "공식\u200b찬양 라이브러리",
    "공식 찬양　라이브러리",
    "공식.찬양.라이브러리",
    "[공식] 찬양 라이브러리",
    "공식 찬양 라이브러리 운영팀",
    "공식 찬양 라이브러리".normalize("NFD"),
    "공식\u3164찬양 라이브러리",
    "공식 \u115f찬양 라이브러리",
    "공식 \u1160찬양 라이브러리",
    "공식 \uffa0찬양 라이브러리",
    "공식 찬양 라이브러\u3164리",
    "\u1100\u1160\u1169\u11bc식 찬양 라이브러리",
    "\u1100\u200b\u1169\u11bc식 찬양 라이브러리",
  ])("%j는 공식 라이브러리처럼 보이는 이름이다", (name) => {
    expect(isReservedUserName(name)).toBe(true);
  });

  it.each([
    "찬양팀",
    "김예배",
    "\u3164찬양팀",
    "공식",
    "찬양 라이브러리",
    "라이브러리 공식 찬양",
  ])("%j는 쓸 수 있는 이름이다", (name) => {
    expect(isReservedUserName(name)).toBe(false);
  });

  it("저장할 이름은 다듬고, 공식 라이브러리처럼 보이면 기본 이름으로 바꾼다", () => {
    expect(toAccountName("  찬양팀  ")).toBe("찬양팀");
    expect(toAccountName(" 공식찬양라이브러리 ")).toBe(
      FALLBACK_USER_NAME.default,
    );
    expect(toAccountName({ x: 1 })).toBe(FALLBACK_USER_NAME.default);
  });

  it("방향 제어 문자는 빼고 저장해 거꾸로 적은 이름이 공식 라이브러리 이름처럼 보이지 않는다", () => {
    expect(toAccountName("\u202e리러브이라 양찬 식공\u202c")).toBe(
      "리러브이라 양찬 식공",
    );
    expect(toAccountName("공식 찬양 \u2067리러브이라\u2069")).toBe(
      "공식 찬양 리러브이라",
    );
    expect(toAccountName("\u200f찬양팀\u200e")).toBe("찬양팀");
    expect(toAccountName("\u202d공식 찬양 라이브러리\u202c")).toBe(
      FALLBACK_USER_NAME.default,
    );
    expect(toAccountName(" \u202e ")).toBe(FALLBACK_USER_NAME.default);
  });
});
