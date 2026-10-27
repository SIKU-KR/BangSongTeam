import { describe, expect, it } from "vitest";
import { FALLBACK_USER_NAME, OFFICIAL_LIBRARY_NAME } from "#shared";
import { isReservedUserName, toAccountName } from "./userNames";

describe("공식 라이브러리 이름", () => {
  it.each([
    OFFICIAL_LIBRARY_NAME,
    " 공식찬양라이브러리 ",
    "공식​찬양 라이브러리",
    "공식 찬양　라이브러리",
    "공식.찬양.라이브러리",
    "[공식] 찬양 라이브러리",
    "공식 찬양 라이브러리 운영팀",
    "공식 찬양 라이브러리".normalize("NFD"),
  ])("%j는 공식 라이브러리처럼 보이는 이름이다", (name) => {
    expect(isReservedUserName(name)).toBe(true);
  });

  it.each(["찬양팀", "공식", "찬양 라이브러리", "라이브러리 공식 찬양"])(
    "%j는 쓸 수 있는 이름이다",
    (name) => {
      expect(isReservedUserName(name)).toBe(false);
    },
  );

  it("저장할 이름은 다듬고, 공식 라이브러리처럼 보이면 기본 이름으로 바꾼다", () => {
    expect(toAccountName("  찬양팀  ")).toBe("찬양팀");
    expect(toAccountName(" 공식찬양라이브러리 ")).toBe(
      FALLBACK_USER_NAME.default,
    );
    expect(toAccountName({ x: 1 })).toBe(FALLBACK_USER_NAME.default);
  });
});
