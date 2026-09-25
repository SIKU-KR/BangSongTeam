import { NOONNU_FONTS, type NoonnuFont } from "#shared";

/** 주입된 폰트 ID 집합 */
const injectedFontIds = new Set<string>();

/** 폰트 이름 및 카드 패밀리명 색인 */
const fontIndex = new Map<string, NoonnuFont>();

for (const font of NOONNU_FONTS) {
  fontIndex.set(font.name, font);
  if (font.cardFamily) {
    fontIndex.set(font.cardFamily, font);
  }
}

/**
 * 폰트 이름 또는 카드 패밀리명으로 눈누 폰트 메타데이터 조회
 */
export function getNoonnuFont(nameOrFamily: string): NoonnuFont | undefined {
  return fontIndex.get(nameOrFamily);
}

/**
 * 웹폰트 동적 로드 (DOM에 @font-face 스타일 또는 stylesheet link 주입)
 */
export function loadWebFont(nameOrFamily: string): void {
  if (typeof document === "undefined") return;

  const font = fontIndex.get(nameOrFamily);
  if (!font || !font.url) return;
  if (injectedFontIds.has(font.id)) return;

  injectedFontIds.add(font.id);

  if (font.format === "css") {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = font.url;
    link.dataset.noonnuFontId = font.id;
    document.head.appendChild(link);
    return;
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
}

/**
 * 여러 폰트의 @font-face 스타일을 한 번에 로드 (글꼴 목록 렌더링용)
 */
export function loadWebFonts(
  namesOrFamilies: readonly (NoonnuFont | string)[],
): void {
  if (typeof document === "undefined") return;
  for (const item of namesOrFamilies) {
    const name = typeof item === "string" ? item : item.name;
    loadWebFont(name);
  }
}

/**
 * 웹폰트 프리로드 및 브라우저 폰트 캐시 준비
 */
export async function preloadWebFont(
  nameOrFamily: string,
  sampleText: string = "가나다라마바사 123 ABC",
): Promise<void> {
  loadWebFont(nameOrFamily);

  if (typeof document === "undefined" || !document.fonts?.load) return;

  try {
    await Promise.all([
      document.fonts.load(`400 1rem "${nameOrFamily}"`, sampleText),
      document.fonts.load(`700 1rem "${nameOrFamily}"`, sampleText),
    ]);
  } catch {
    // 폰트 로드 실패 시 기본 폰트로 안전 폴백
  }
}
