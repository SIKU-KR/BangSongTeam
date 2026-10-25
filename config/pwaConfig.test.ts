import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { collectShells, matchShell } from "../scripts/buildServiceWorker.mjs";
import { OFFLINE_SHELL_PARAM } from "../src/shared/constants/projection";

describe("PWA 설정", () => {
  const rootDir = path.resolve(__dirname, "..");
  const config = fs.readFileSync(
    path.join(rootDir, "scripts/buildServiceWorker.mjs"),
    "utf-8",
  );

  it("미디어 캐시 이름과 경로를 공용 상수에서 가져온다", () => {
    expect(config).toContain('from "../src/shared/constants/projection.ts"');
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
      config.indexOf("for (const warning of warnings)"),
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
    const globPatterns = config.match(/globPatterns: \[[^\]]*\]/)?.[0];
    expect(globPatterns).toBeDefined();
    expect(globPatterns).not.toMatch(/webp|font-previews|woff/);
  });

  it("나뉜 JS 청크도 모두 프리캐시해 오프라인에서 각 화면이 열린다", () => {
    expect(config).toContain('globPatterns: [".next/static/**/*.{js,css}"');
    expect(config).toContain('".next/static/": "/_next/static/"');
  });

  it("송출 중 자동 갱신을 막기 위해 새 SW가 스스로 대기를 건너뛰지 않는다", () => {
    expect(config).toContain("skipWaiting: false");
  });

  it("화면 이동은 프리캐시한 셸로 답하고 /api는 제외한다", () => {
    expect(config).toContain("importScripts: [`/${SHELL_SCRIPT}`]");
    expect(config).toContain('url.pathname.startsWith("/api/")');
  });

  it("sw.js는 매번 재검증한다 (해시가 붙은 /_next/static/*은 Next.js가 immutable로 준다)", async () => {
    const { default: nextConfig } = await import("../next.config");
    const headers = await nextConfig.headers?.();
    expect(headers).toEqual([
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
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

  it("눈누 CDN 글꼴은 공용 패턴으로 CSS, 글꼴 파일, 확장자 규칙 순서로 맞춰 따로 담는다", () => {
    const stylesheetRule = config.indexOf(
      "urlPattern: CDN_FONT_STYLESHEET_PATTERN",
    );
    const cdnRule = config.indexOf("urlPattern: CDN_FONT_URL_PATTERN");
    const bundledRule = config.indexOf("urlPattern: /\\.(?:woff2?");
    expect(stylesheetRule).toBeGreaterThan(-1);
    expect(stylesheetRule).toBeLessThan(cdnRule);
    expect(cdnRule).toBeLessThan(bundledRule);
    expect(config).toContain("cacheName: CDN_FONT_STYLESHEET_CACHE_NAME");
    expect(config).toContain("cacheName: CDN_FONT_CACHE_NAME");
  });

  it("CDN 글꼴 CSS는 담긴 오류가 남지 않게 다시 받고, 글꼴 파일은 200만 담는다", () => {
    const stylesheetOptions = config.slice(
      config.indexOf("urlPattern: CDN_FONT_STYLESHEET_PATTERN"),
      config.indexOf("urlPattern: CDN_FONT_URL_PATTERN"),
    );
    expect(stylesheetOptions).toContain('handler: "StaleWhileRevalidate"');
    const fontOptions = config.slice(
      config.indexOf("urlPattern: CDN_FONT_URL_PATTERN"),
      config.indexOf("urlPattern: /\\.(?:woff2?"),
    );
    expect(fontOptions).toContain("statuses: [200] }");
  });

  it("영상 저장의 용량 오류가 송출 글꼴 캐시를 지우지 않게 purgeOnQuotaError를 쓰지 않는다", () => {
    expect(config).not.toMatch(/purgeOnQuotaError:\s*true/);
  });

  it("PWA 아이콘 파일이 실제로 존재한다", () => {
    const iconsDir = path.join(rootDir, "public/icons");
    for (const file of ["icon-192.png", "icon-512.png", "maskable-512.png"]) {
      expect(fs.existsSync(path.join(iconsDir, file))).toBe(true);
    }
  });
});

describe("오프라인 화면 셸", () => {
  const P = OFFLINE_SHELL_PARAM;
  const shells = collectShells(
    {
      "/": { dataRoute: "/index.rsc" },
      "/_not-found": { dataRoute: "/_not-found.rsc" },
      "/manifest.webmanifest": { dataRoute: null },
      "/presentations": { dataRoute: "/presentations.rsc" },
      "/presentations/trash": { dataRoute: "/presentations/trash.rsc" },
      [`/presentations/folders/${P}`]: { dataRoute: "/x.rsc" },
      [`/editor/${P}`]: { dataRoute: "/x.rsc" },
      [`/present/${P}/fullscreen`]: { dataRoute: "/x.rsc" },
    },
    P,
  );

  it("미리 렌더한 화면만 셸로 모으고 Next.js 내부 페이지는 뺀다", () => {
    expect(shells.map((shell: { route: string }) => shell.route)).toEqual([
      "/",
      "/presentations",
      "/presentations/trash",
      `/presentations/folders/${P}`,
      `/editor/${P}`,
      `/present/${P}/fullscreen`,
    ]);
    expect(shells[0]).toMatchObject({ file: "index.html" });
    expect(shells[4]).toMatchObject({ file: `editor/${P}.html` });
  });

  it("정적 화면은 그 셸로, 동적 화면은 자리 값과 함께 맞춘다", () => {
    expect(matchShell("/", shells, P)).toEqual({ route: "/", value: null });
    expect(matchShell("/presentations/trash", shells, P)).toEqual({
      route: "/presentations/trash",
      value: null,
    });
    expect(matchShell("/editor/abc_DEF-123", shells, P)).toEqual({
      route: `/editor/${P}`,
      value: "abc_DEF-123",
    });
    expect(matchShell("/present/p1/fullscreen", shells, P)).toEqual({
      route: `/present/${P}/fullscreen`,
      value: "p1",
    });
  });

  it("모르는 주소, 끝 슬래시, 셸에 그대로 넣을 수 없는 값은 맞추지 않는다", () => {
    expect(matchShell("/unknown", shells, P)).toBeNull();
    expect(matchShell("/presentations/", shells, P)).toBeNull();
    expect(matchShell("/editor/a%22b", shells, P)).toBeNull();
    expect(matchShell("/present/p1", shells, P)).toBeNull();
  });

  it("동적 자리가 둘 이상인 화면은 빌드를 멈춘다", () => {
    expect(() =>
      collectShells({ [`/a/${P}/${P}`]: { dataRoute: "/x.rsc" } }, P),
    ).toThrow();
  });
});
