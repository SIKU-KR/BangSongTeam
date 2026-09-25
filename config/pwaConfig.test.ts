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
    expect(config).toContain("${MEDIA_URL_PREFIX}");
    expect(config).not.toMatch(/const MEDIA_(CACHE_NAME|URL_PREFIX) =/);
  });

  it("미디어 런타임 캐시가 CacheFirst + Range 지원으로 설정되어 있다", () => {
    expect(config).toContain('handler: "CacheFirst"');
    expect(config).toContain("rangeRequests: true");
    expect(config).toContain("statuses: [200] }");
    expect(config).not.toContain("206]");
  });

  it("오프라인 새로고침을 위한 navigateFallback이 있고 /api는 제외된다", () => {
    expect(config).toContain('navigateFallback: "index.html"');
    expect(config).toContain("navigateFallbackDenylist");
  });

  it("송출 중 자동 갱신을 막기 위해 registerType이 prompt다", () => {
    expect(config).toContain('registerType: "prompt"');
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

  it("PWA 아이콘 파일이 실제로 존재한다", () => {
    const iconsDir = path.join(rootDir, "src/client/public/icons");
    for (const file of ["icon-192.png", "icon-512.png", "maskable-512.png"]) {
      expect(fs.existsSync(path.join(iconsDir, file))).toBe(true);
    }
  });
});
