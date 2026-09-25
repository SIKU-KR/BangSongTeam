import { describe, it, expect, beforeEach } from "vitest";
import {
  NOONNU_FONTS,
  SUPPORTED_FONTS,
  DEFAULT_PRESET_FONTS,
  DeckStyleSchema,
} from "#shared";
import { loadWebFont, getNoonnuFont, preloadWebFont } from "./fontLoader";

describe("눈누(noonnu.cc) 웹폰트 카탈로그 및 동적 로더", () => {
  beforeEach(() => {
    // DOM head 정리
    const injected = document.querySelectorAll(
      "style[data-noonnu-font-id], link[data-noonnu-font-id]",
    );
    injected.forEach((el) => el.remove());
  });

  it("눈누 전체 웹폰트(1,100종 이상)가 카탈로그에 포함되어 있다", () => {
    expect(NOONNU_FONTS.length).toBeGreaterThan(1100);
    expect(SUPPORTED_FONTS.length).toBeGreaterThan(1100);
  });

  it("기본 프리셋 5종이 SUPPORTED_FONTS에 유지된다", () => {
    for (const font of DEFAULT_PRESET_FONTS) {
      expect(SUPPORTED_FONTS).toContain(font);
    }
  });

  it("눈누 대표 폰트들이 카탈로그 및 스키마 유효성 검사를 통과한다", () => {
    const sampleFonts = [
      "고운바탕",
      "페이퍼로지",
      "G마켓 산스",
      "여기어때 잘난체",
      "수트",
      "카페24 써라운드",
      "나눔스퀘어",
      "에스코어드림",
    ];

    for (const name of sampleFonts) {
      expect(SUPPORTED_FONTS).toContain(name);
      expect(() => DeckStyleSchema.parse({ fontFamily: name })).not.toThrow();
    }
  });

  it("허용되지 않은 임의의 폰트는 스키마 검증에서 거부된다", () => {
    expect(() =>
      DeckStyleSchema.parse({ fontFamily: "UnknownArbitraryFont123" }),
    ).toThrow();
  });

  it("loadWebFont는 DOM에 @font-face 스타일을 동적으로 주입한다", () => {
    loadWebFont("페이퍼로지");

    const style = document.querySelector(
      "style[data-noonnu-font-id]",
    ) as HTMLStyleElement | null;
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("Paperlogy");
    expect(style?.textContent).toContain("@font-face");
  });

  it("동일 폰트의 중복 loadWebFont 호출 시 태그를 중복 생성하지 않는다", () => {
    loadWebFont("수트");
    const countFirst = document.querySelectorAll(
      "style[data-noonnu-font-id]",
    ).length;

    loadWebFont("수트");
    const countSecond = document.querySelectorAll(
      "style[data-noonnu-font-id]",
    ).length;

    expect(countFirst).toBe(countSecond);
  });

  it("getNoonnuFont는 한글 이름 및 카드 패밀리명으로 조회된다", () => {
    const byName = getNoonnuFont("페이퍼로지");
    expect(byName).toBeDefined();
    expect(byName?.url).toContain("Paperlogy");

    const byFamily = getNoonnuFont(byName!.cardFamily);
    expect(byFamily).toBeDefined();
    expect(byFamily?.id).toBe(byName?.id);
  });

  it("preloadWebFont는 에러 없이 안전하게 실행된다", async () => {
    await expect(
      preloadWebFont("고운바탕", "찬양 슬라이드 테스트"),
    ).resolves.not.toThrow();
  });
});
