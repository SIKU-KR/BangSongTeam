import { loadNoonnuFontCatalog, type NoonnuFont } from "#shared";

/**
 * npm으로 번들한 글꼴. 카탈로그의 CDN 주소 대신 자체 오리진에서 받는다.
 *
 * Pretendard는 앱 UI 글꼴이라 `index.css`가 늘 싣는다. 가사용 글꼴(Noto Sans KR,
 * 나눔명조)은 `@font-face`만 수백 개라 렌더링을 막는 메인 CSS에서 빼고, 스테이지가
 * 그 글꼴을 처음 그릴 때 CSS 청크를 붙인다.
 */
const BUNDLED_FONT_STYLESHEETS: Record<
  string,
  (() => Promise<unknown>) | null
> = {
  Pretendard: null,
  "Noto Sans KR": () =>
    Promise.all([
      import("@fontsource/noto-sans-kr/400.css"),
      import("@fontsource/noto-sans-kr/700.css"),
    ]),
  "Nanum Myeongjo": () =>
    Promise.all([
      import("@fontsource/nanum-myeongjo/400.css"),
      import("@fontsource/nanum-myeongjo/700.css"),
    ]),
};

/**
 * 저장된 글꼴 이름과 실제 `@font-face` 패밀리가 다른 번들 글꼴.
 * Pretendard는 굵기별 정적 서브셋 CSS만 540 KB라 variable dynamic subset을 쓰고,
 * 그 패밀리명이 `Pretendard Variable`이다.
 */
const BUNDLED_FONT_FAMILIES: Record<string, string> = {
  Pretendard: "Pretendard Variable",
};

/** 불러오기를 시작한 폰트 ID(번들 글꼴은 이름)별 로드 약속 */
const loadingFonts = new Map<string, Promise<void>>();

let fontIndexPromise: Promise<Map<string, NoonnuFont>> | undefined;

/**
 * 이름·카드 패밀리명 색인. 카탈로그 청크를 처음 찾을 때 한 번만 불러온다.
 * 청크를 받지 못하면 빈 색인으로 두어 기본 글꼴로 그리고, 다음 호출에서 다시 받는다.
 */
function loadFontIndex(): Promise<Map<string, NoonnuFont>> {
  fontIndexPromise ??= loadNoonnuFontCatalog().then(
    (fonts) => {
      const index = new Map<string, NoonnuFont>();
      for (const font of fonts) {
        index.set(font.name, font);
        if (font.cardFamily) index.set(font.cardFamily, font);
      }
      return index;
    },
    () => {
      fontIndexPromise = undefined;
      return new Map<string, NoonnuFont>();
    },
  );
  return fontIndexPromise;
}

/**
 * 폰트 이름 또는 카드 패밀리명으로 눈누 폰트 메타데이터 조회.
 * 저장된 덱의 글꼴을 찾을 때 카탈로그 청크를 불러오므로 비동기다.
 */
export async function getNoonnuFont(
  nameOrFamily: string,
): Promise<NoonnuFont | undefined> {
  return (await loadFontIndex()).get(nameOrFamily);
}

/**
 * 덱에 저장된 글꼴 이름을 CSS `font-family` 값으로 바꾼다.
 * 스테이지와 넘침 측정기가 같은 글꼴로 그리고 재려면 둘 다 이 값을 써야 한다.
 */
export function toCssFontFamily(nameOrFamily: string): string {
  const family = BUNDLED_FONT_FAMILIES[nameOrFamily];
  return family ? `"${family}", "${nameOrFamily}"` : `"${nameOrFamily}"`;
}

function loadBundledFont(
  name: string,
  loadStylesheet: () => Promise<unknown>,
): Promise<void> {
  const existing = loadingFonts.get(name);
  if (existing) return existing;

  const loading = loadStylesheet().then(
    () => undefined,
    () => {
      loadingFonts.delete(name);
    },
  );
  loadingFonts.set(name, loading);
  return loading;
}

/**
 * 웹폰트 동적 로드. 번들 글꼴은 CSS 청크를, 눈누 글꼴은 @font-face 스타일 또는
 * stylesheet link를 붙인다. 번들 글꼴은 `@font-face`가 문서에 들어간 뒤 끝나므로,
 * 곧바로 `document.fonts.load`를 부르려면 기다려야 한다.
 */
export async function loadWebFont(nameOrFamily: string): Promise<void> {
  if (typeof document === "undefined") return;

  if (nameOrFamily in BUNDLED_FONT_STYLESHEETS) {
    const loadStylesheet = BUNDLED_FONT_STYLESHEETS[nameOrFamily];
    if (loadStylesheet) await loadBundledFont(nameOrFamily, loadStylesheet);
    return;
  }

  const font = await getNoonnuFont(nameOrFamily);
  if (!font || !font.url) return;

  const existing = loadingFonts.get(font.id);
  if (existing) return existing;

  const loaded = Promise.resolve();
  loadingFonts.set(font.id, loaded);

  if (font.format === "css") {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = font.url;
    link.dataset.noonnuFontId = font.id;
    document.head.appendChild(link);
    return loaded;
  }

  const style = document.createElement("style");
  style.dataset.noonnuFontId = font.id;

  const faces = [
    `@font-face {
  font-family: '${font.name}';
  src: url('${font.url}') format('${font.format || "woff2"}');
  font-weight: ${font.weight || "normal"};
  font-display: swap;
}`,
  ];

  if (font.cardFamily && font.cardFamily !== font.name) {
    faces.push(`@font-face {
  font-family: '${font.cardFamily}';
  src: url('${font.url}') format('${font.format || "woff2"}');
  font-weight: ${font.weight || "normal"};
  font-display: swap;
}`);
  }

  style.textContent = faces.join("\n");
  document.head.appendChild(style);
  return loaded;
}

/**
 * 웹폰트 프리로드 및 브라우저 폰트 캐시 준비
 */
export async function preloadWebFont(
  nameOrFamily: string,
  sampleText: string = "가나다라마바사 123 ABC",
): Promise<void> {
  await loadWebFont(nameOrFamily);

  if (typeof document === "undefined" || !document.fonts?.load) return;

  const family = toCssFontFamily(nameOrFamily);
  try {
    await Promise.all([
      document.fonts.load(`400 1rem ${family}`, sampleText),
      document.fonts.load(`700 1rem ${family}`, sampleText),
    ]);
  } catch {
    // 폰트 로드 실패 시 기본 폰트로 안전 폴백
  }
}
