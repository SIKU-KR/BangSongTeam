import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadNoonnuFontCatalog,
  SUPPORTED_FONTS,
  DEFAULT_PRESET_FONTS,
  DeckStyleSchema,
  STYLESHEET_FONT_FAMILIES,
} from "#shared";
import { loadWebFont, getNoonnuFont, toCssFontFamily } from "./fontLoader";

function stylesheetLink(fontId: string): Promise<HTMLLinkElement> {
  return vi.waitFor(() => {
    const link = document.querySelector<HTMLLinkElement>(
      `link[data-noonnu-font-id="${fontId}"]`,
    );
    expect(link).not.toBeNull();
    return link!;
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const EARLY_ACCESS_STYLESHEET =
  /^(?:https:)?\/\/fonts\.googleapis\.com\/earlyaccess\/(\w+)\.css$/;

const GRADUATED_EARLY_ACCESS_FONTS = new Set([
  "notosanskr",
  "nanummyeongjo",
  "nanumgothic",
  "nanumgothiccoding",
  "nanumbrushscript",
  "nanumpenscript",
]);

describe("눈누(noonnu.cc) 웹폰트 카탈로그 및 동적 로더", () => {
  beforeEach(() => {
    // DOM head 정리
    const injected = document.querySelectorAll(
      "style[data-noonnu-font-id], link[data-noonnu-font-id]",
    );
    injected.forEach((el) => el.remove());
  });

  it("눈누 전체 웹폰트(1,100종 이상)가 카탈로그에 포함되어 있다", async () => {
    expect((await loadNoonnuFontCatalog()).length).toBeGreaterThan(1100);
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

  it("loadWebFont는 DOM에 @font-face 스타일을 동적으로 주입한다", async () => {
    await loadWebFont("페이퍼로지");

    const style = document.querySelector(
      "style[data-noonnu-font-id]",
    ) as HTMLStyleElement | null;
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("Paperlogy");
    expect(style?.textContent).toContain("@font-face");
  });

  it("동일 폰트의 중복 loadWebFont 호출 시 태그를 중복 생성하지 않는다", async () => {
    await loadWebFont("수트");
    const countFirst = document.querySelectorAll(
      "style[data-noonnu-font-id]",
    ).length;

    await loadWebFont("수트");
    const countSecond = document.querySelectorAll(
      "style[data-noonnu-font-id]",
    ).length;

    expect(countFirst).toBe(countSecond);
  });

  it("번들 글꼴은 카탈로그의 CDN 주소를 문서에 붙이지 않는다", async () => {
    await Promise.all([
      loadWebFont("Pretendard"),
      loadWebFont("Noto Sans KR"),
      loadWebFont("Nanum Myeongjo"),
    ]);

    expect(
      document.querySelectorAll(
        "style[data-noonnu-font-id], link[data-noonnu-font-id]",
      ),
    ).toHaveLength(0);
  });

  it("toCssFontFamily는 Pretendard를 variable 패밀리로 바꾸고 나머지는 그대로 감싼다", () => {
    expect(toCssFontFamily("Pretendard")).toBe(
      '"Pretendard Variable", "Pretendard"',
    );
    expect(toCssFontFamily("Noto Sans KR")).toBe('"Noto Sans KR"');
    expect(toCssFontFamily("페이퍼로지")).toBe('"페이퍼로지"');
  });

  it("CSS로 싣는 카탈로그 글꼴은 스타일시트가 선언한 영문 패밀리로 먼저 그린다", () => {
    expect(toCssFontFamily("나눔스퀘어")).toBe('"NanumSquare", "나눔스퀘어"');
    expect(toCssFontFamily("검은고딕")).toBe('"Black Han Sans", "검은고딕"');
    expect(toCssFontFamily("NanumSquare")).toBe('"NanumSquare"');
  });

  it("CSS로 싣는 카탈로그 글꼴은 모두 카드 패밀리명(스타일시트의 패밀리)으로 그린다", async () => {
    const stylesheetFonts = (await loadNoonnuFontCatalog()).filter(
      (font) => font.format === "css",
    );

    const drawnWithFallback = stylesheetFonts
      .filter(
        (font) =>
          !toCssFontFamily(font.name).startsWith(`"${font.cardFamily}"`),
      )
      .map((font) => font.name);
    expect(drawnWithFallback).toEqual([]);
    expect(STYLESHEET_FONT_FAMILIES).toEqual(
      Object.fromEntries(
        stylesheetFonts
          .filter((font) => font.name !== font.cardFamily)
          .map((font) => [font.name, font.cardFamily]),
      ),
    );
  });

  it("Google 얼리 액세스 스타일시트는 정식 Google Fonts로 옮겨 간 글꼴만 가리킨다(나머지는 글꼴 파일이 지워졌다)", async () => {
    const filesRemoved = (await loadNoonnuFontCatalog())
      .filter((font) => {
        const slug = EARLY_ACCESS_STYLESHEET.exec(font.url)?.[1];
        return slug !== undefined && !GRADUATED_EARLY_ACCESS_FONTS.has(slug);
      })
      .map((font) => font.name);

    expect(filesRemoved).toEqual([]);
  });

  it("CSS로 싣는 글꼴은 스타일시트를 받은 뒤에야 불러오기를 마친다", async () => {
    let done = false;
    const loading = loadWebFont("검은고딕").then(() => {
      done = true;
    });

    const link = await stylesheetLink("106");
    await settle();
    expect(done).toBe(false);

    link.dispatchEvent(new Event("load"));
    await loading;
    expect(done).toBe(true);
  });

  it("스타일시트를 받지 못하면 링크를 걷어 내고 다음 호출에서 다시 받는다", async () => {
    const first = loadWebFont("한나체");
    const failed = await stylesheetLink("52");
    failed.dispatchEvent(new Event("error"));
    await first;

    expect(failed.isConnected).toBe(false);

    const retry = loadWebFont("한나체");
    const again = await stylesheetLink("52");
    expect(again).not.toBe(failed);
    again.dispatchEvent(new Event("load"));
    await retry;
  });

  it("getNoonnuFont는 한글 이름 및 카드 패밀리명으로 조회된다", async () => {
    const byName = await getNoonnuFont("페이퍼로지");
    expect(byName).toBeDefined();
    expect(byName?.url).toContain("Paperlogy");

    const byFamily = await getNoonnuFont(byName!.cardFamily);
    expect(byFamily).toBeDefined();
    expect(byFamily?.id).toBe(byName?.id);
  });
});
