import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

describe("PWA 설정", () => {
  const rootDir = path.resolve(__dirname, "..");
  const config = fs.readFileSync(path.join(rootDir, "vite.config.ts"), "utf-8");

  it("미디어 캐시 이름과 경로를 공용 상수에서 가져온다", () => {
    expect(config).toContain('from "./src/shared/constants/projection"');
    expect(config).toContain("cacheName: MEDIA_CACHE_NAME");
    expect(config).toContain("new RegExp(MEDIA_URL_PREFIX");
    expect(config).not.toMatch(/const MEDIA_(CACHE_NAME|URL_PREFIX) =/);
  });

  it("포스터는 영상보다 먼저 맞춰 따로 담고, 영상 캐시에는 개수 한도가 없다", () => {
    const posterRule = config.indexOf("new RegExp(POSTER_URL_PREFIX");
    const mediaRule = config.indexOf("new RegExp(MEDIA_URL_PREFIX");
    expect(posterRule).toBeGreaterThan(-1);
    expect(posterRule).toBeLessThan(mediaRule);
    expect(config).toContain("cacheName: POSTER_CACHE_NAME");

    const mediaOptions = config.slice(
      config.indexOf("cacheName: MEDIA_CACHE_NAME"),
      config.indexOf("devOptions"),
    );
    expect(mediaOptions).not.toContain("expiration");
  });

  it("처음 설치된 SW가 곧바로 페이지를 제어해 첫 방문에도 캐시본으로 송출한다", () => {
    expect(config).toContain("clientsClaim: true");
  });

  it("미디어 런타임 캐시가 CacheFirst + Range 지원으로 설정되어 있다", () => {
    expect(config).toContain('handler: "CacheFirst"');
    expect(config).toContain("rangeRequests: true");
    expect(config).toContain("statuses: [200] }");
    expect(config).not.toContain("206]");
  });

  it("글꼴 미리보기 이미지는 프리캐시하지 않고 런타임에 본 것만 캐시한다", () => {
    expect(config).toContain('cacheName: "worship-font-previews-cache"');
    expect(config).toMatch(/globPatterns: \[[^\]]*\]/);
    expect(config.match(/globPatterns: \[[^\]]*\]/)?.[0]).not.toMatch(
      /webp|font-previews/,
    );
  });

  it("오프라인 새로고침을 위한 navigateFallback이 있고 /api는 제외된다", () => {
    expect(config).toContain('navigateFallback: "index.html"');
    expect(config).toContain("navigateFallbackDenylist");
  });

  it("송출 중 자동 갱신을 막기 위해 registerType이 prompt다", () => {
    expect(config).toContain('registerType: "prompt"');
  });

  it("나뉜 JS 청크도 모두 프리캐시해 오프라인에서 각 화면이 열린다", () => {
    expect(config).toContain('globPatterns: ["**/*.{js,');
  });

  it("해시가 붙은 /assets/*만 immutable로 캐시하고 index.html·sw.js는 재검증한다", () => {
    const headers = fs.readFileSync(
      path.join(rootDir, "src/client/public/_headers"),
      "utf-8",
    );
    const rules = headers
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"));
    expect(rules).toEqual([
      "/assets/*",
      "  Cache-Control: public, max-age=31536000, immutable",
    ]);
  });

  it("글꼴 캐시 한도가 번들 글꼴 서브셋을 모두 담는다", () => {
    const fontCache = config.slice(
      config.indexOf('cacheName: "worship-fonts-cache"'),
    );
    const maxEntries = Number(/maxEntries: (\d+)/.exec(fontCache)?.[1]);
    const subsetCount = [
      "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css",
      "@fontsource/noto-sans-kr/400.css",
      "@fontsource/noto-sans-kr/700.css",
      "@fontsource/nanum-myeongjo/400.css",
      "@fontsource/nanum-myeongjo/700.css",
    ]
      .map((file) =>
        fs.readFileSync(createRequire(import.meta.url).resolve(file), "utf-8"),
      )
      .reduce((sum, css) => sum + css.split("@font-face").length - 1, 0);

    expect(maxEntries).toBeGreaterThanOrEqual(subsetCount);
  });

  it("눈누 CDN 글꼴은 공용 패턴으로 확장자 규칙보다 먼저 맞춰 따로 담는다", () => {
    const cdnRule = config.indexOf("urlPattern: CDN_FONT_URL_PATTERN");
    const bundledRule = config.indexOf("urlPattern: /\\.(?:woff2?");
    expect(cdnRule).toBeGreaterThan(-1);
    expect(cdnRule).toBeLessThan(bundledRule);
    expect(config).toContain("cacheName: CDN_FONT_CACHE_NAME");
  });

  it("PWA 아이콘 파일이 실제로 존재한다", () => {
    const iconsDir = path.join(rootDir, "src/client/public/icons");
    for (const file of ["icon-192.png", "icon-512.png", "maskable-512.png"]) {
      expect(fs.existsSync(path.join(iconsDir, file))).toBe(true);
    }
  });
});
