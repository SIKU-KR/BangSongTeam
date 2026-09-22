import { describe, it, expect } from "vitest";
import { normalizeCatalogKey, buildCatalogKey } from "./catalogKey";

describe("가사 카탈로그 정규화 키", () => {
  it("공백을 제거한다", () => {
    expect(normalizeCatalogKey("은혜 로다")).toBe("은혜로다");
  });

  it("대소문자를 통일한다", () => {
    expect(normalizeCatalogKey("Amazing Grace")).toBe("amazinggrace");
  });

  it("괄호·특수문자를 제거한다", () => {
    // 같은 곡이 '시선', '시선 (Live)', '시선!'으로 들어와도 한 카탈로그로 모여야 한다.
    expect(normalizeCatalogKey("시선 (Live)")).toBe("시선live");
    expect(normalizeCatalogKey("시선!")).toBe("시선");
    expect(normalizeCatalogKey("주 품에 - 품으소서")).toBe("주품에품으소서");
  });

  it("전각·반각을 통일한다", () => {
    expect(normalizeCatalogKey("ＡＢＣ")).toBe("abc");
  });

  it("숫자는 남긴다", () => {
    expect(normalizeCatalogKey("10000 Reasons")).toBe("10000reasons");
  });

  it("빈 문자열과 공백만 있는 값을 안전하게 처리한다", () => {
    expect(normalizeCatalogKey("")).toBe("");
    expect(normalizeCatalogKey("   ")).toBe("");
  });

  it("제목·아티스트를 한 쌍으로 만든다", () => {
    expect(buildCatalogKey("은혜 로다", "예수전도단")).toEqual({
      titleNorm: "은혜로다",
      artistNorm: "예수전도단",
    });
  });

  it("아티스트가 비어 있어도 동작한다", () => {
    expect(buildCatalogKey("소원", "")).toEqual({
      titleNorm: "소원",
      artistNorm: "",
    });
  });
});
