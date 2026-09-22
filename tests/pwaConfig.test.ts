import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Vite 설정 로더는 워크스페이스 TS 패키지를 import할 수 없어 vite.config.ts가
 * 캐시 이름과 미디어 경로를 복제해 갖고 있다. 값이 갈라지면 예배 준비 화면이
 * 채운 캐시를 Service Worker가 못 읽는다 — 그 어긋남을 여기서 막는다.
 */
describe("M4-1: PWA 설정과 공용 상수 정합성", () => {
  const viteConfigPath = path.resolve(
    __dirname,
    "../apps/web/vite.config.ts",
  );
  const config = fs.readFileSync(viteConfigPath, "utf-8");

  // 루트 워크스페이스는 @repo/shared를 의존하지 않으므로 소스에서 직접 읽는다.
  const sharedConstants = fs.readFileSync(
    path.resolve(__dirname, "../packages/shared/src/constants/projection.ts"),
    "utf-8",
  );
  const readConst = (name: string): string => {
    const match = sharedConstants.match(
      new RegExp(`export const ${name} = "([^"]+)"`),
    );
    if (!match) throw new Error(`${name} not found in shared constants`);
    return match[1];
  };
  const MEDIA_CACHE_NAME = readConst("MEDIA_CACHE_NAME");
  const MEDIA_URL_PREFIX = readConst("MEDIA_URL_PREFIX");

  it("vite.config.ts의 캐시 이름이 MEDIA_CACHE_NAME과 같다", () => {
    expect(config).toContain(`const MEDIA_CACHE_NAME = "${MEDIA_CACHE_NAME}"`);
  });

  it("vite.config.ts의 미디어 경로가 MEDIA_URL_PREFIX와 같다", () => {
    expect(config).toContain(`const MEDIA_URL_PREFIX = "${MEDIA_URL_PREFIX}"`);
  });

  it("미디어 런타임 캐시가 CacheFirst + Range 지원으로 설정되어 있다", () => {
    expect(config).toContain('handler: "CacheFirst"');
    expect(config).toContain("rangeRequests: true");
    expect(config).toContain("statuses: [200, 206]");
  });

  it("오프라인 새로고침을 위한 navigateFallback이 있고 /api는 제외된다", () => {
    expect(config).toContain('navigateFallback: "index.html"');
    expect(config).toContain("navigateFallbackDenylist");
  });

  it("송출 중 자동 갱신을 막기 위해 registerType이 prompt다", () => {
    expect(config).toContain('registerType: "prompt"');
  });

  it("PWA 아이콘 파일이 실제로 존재한다", () => {
    const iconsDir = path.resolve(__dirname, "../apps/web/public/icons");
    for (const file of [
      "icon-192.png",
      "icon-512.png",
      "maskable-512.png",
    ]) {
      expect(fs.existsSync(path.join(iconsDir, file))).toBe(true);
    }
  });
});
