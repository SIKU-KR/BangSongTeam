import { describe, expect, it } from "vitest";
import { FALLBACK_USER_NAME } from "#shared";
import { toAccountName } from "./userNames";

describe("toAccountName", () => {
  it("저장할 이름은 다듬고, 이름이 아니면 기본 이름으로 바꾼다", () => {
    expect(toAccountName("  찬양팀  ")).toBe("찬양팀");
    expect(toAccountName({ x: 1 })).toBe(FALLBACK_USER_NAME.default);
  });

  it("방향 제어 문자는 빼고 저장해 거꾸로 적은 이름이 다른 이름처럼 보이지 않는다", () => {
    expect(toAccountName("‮팀양찬‬")).toBe("팀양찬");
    expect(toAccountName("찬양 ⁧팀⁩")).toBe("찬양 팀");
    expect(toAccountName("‏찬양팀‎")).toBe("찬양팀");
    expect(toAccountName(" ‮ ")).toBe(FALLBACK_USER_NAME.default);
  });

  it("짝을 잃은 서로게이트는 U+FFFD로 바꿔 저장할 수 있는 이름으로 두고, 온전한 이모지는 그대로 둔다", () => {
    expect(toAccountName("찬양팀\uD83D")).toBe("찬양팀�");
    expect(toAccountName("\uDE00찬양팀 😀")).toBe("�찬양팀 😀");
  });
});
