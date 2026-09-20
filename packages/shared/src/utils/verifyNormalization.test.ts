import { describe, it, expect } from "vitest";
import { verifyNormalization } from "./verifyNormalization";

describe("verifyNormalization", () => {
  const version1 = `시작됐네 우리 주님의 능력이
나의 삶을 다스리시네
주의 사랑이 온 땅을 덮고`;

  const version2 = `시작됐네 우리 주님의 능력이
나의 삶을 다스리시네
주의 은혜가 내 맘을 채우네`;

  it("passes when every line in canonical exists in at least one input version", () => {
    const canonical = `시작됐네 우리 주님의 능력이
나의 삶을 다스리시네

주의 사랑이 온 땅을 덮고
주의 은혜가 내 맘을 채우네`;

    expect(verifyNormalization(canonical, [version1, version2])).toBe(true);
  });

  it("ignores whitespace differences when matching lines", () => {
    const canonical = `  시작됐네   우리   주님의   능력이  
나의 삶을 다스리시네`;

    expect(verifyNormalization(canonical, [version1])).toBe(true);
  });

  it("allows blank lines in canonical output", () => {
    const canonical = `\n\n시작됐네 우리 주님의 능력이\n\n\n나의 삶을 다스리시네\n\n`;
    expect(verifyNormalization(canonical, [version1])).toBe(true);
  });

  it("rejects canonical when it contains a hallucinated or fabricated line", () => {
    const canonical = `시작됐네 우리 주님의 능력이
나의 삶을 다스리시네
할렐루야 주를 찬양합니다`; // Not in version1 or version2

    expect(verifyNormalization(canonical, [version1, version2])).toBe(false);
  });

  it("rejects when input versions are empty", () => {
    const canonical = `시작됐네 우리 주님의 능력이`;
    expect(verifyNormalization(canonical, [])).toBe(false);
  });
});
