import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

/**
 * `@repo/shared`의 `MEDIA_CACHE_NAME`·`MEDIA_URL_PREFIX`와 같은 값이어야 한다.
 *
 * Vite의 설정 로더는 워크스페이스 패키지를 외부 모듈로 두고 Node ESM으로 읽는데,
 * `@repo/shared`는 확장자 없는 TS 소스를 그대로 export해서 여기서는 import할 수 없다.
 * 그래서 값을 복제하고, 어긋나면 터지도록 `tests/pwaConfig.test.ts`로 고정한다.
 */
const MEDIA_CACHE_NAME = "worship-videos-cache";
const MEDIA_URL_PREFIX = "/api/media/";

/**
 * 오프라인 송출 보장을 위한 PWA 구성 (TECH_SPEC 5.4).
 *
 * - `registerType: "prompt"`: 자동 갱신을 쓰지 않는다. 배포가 나간 순간 송출 중인
 *   페이지가 새로고침되면 예배가 끊긴다. 갱신은 사용자가 편집 화면에서 직접 누른다.
 * - `generateSW` 전략이므로 설정이 직렬화된다. TECH_SPEC 5.4-2의 함수형 urlPattern과
 *   `new RangeRequestsPlugin()` 인스턴스는 injectManifest 전용이라 쓸 수 없고,
 *   선언형 등가 옵션(`rangeRequests`, `cacheableResponse`, `expiration`)으로 옮겼다.
 * - 배경 영상 캐시 이름은 `@repo/shared`의 `MEDIA_CACHE_NAME`과 같아야 한다.
 *   예배 준비 화면이 같은 캐시에 직접 써 넣기 때문에 값이 어긋나면 안 된다.
 */
export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "prompt",
      // 등록은 src/pwa/registerServiceWorker.ts에서 직접 한다 (갱신 시점 통제).
      injectRegister: null,
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "Worship Slide",
        short_name: "Worship",
        description: "예배 찬양 슬라이드 제작 및 송출 도구",
        lang: "ko",
        start_url: "/presentations",
        scope: "/",
        display: "standalone",
        orientation: "landscape",
        // 송출 화면은 테마와 무관하게 항상 검정이다 (PRD 6.5).
        theme_color: "#09090b",
        background_color: "#09090b",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // 앱 셸만 프리캐시한다. 폰트를 여기 넣으면 33MB짜리 설치가 된다 —
        // Pretendard 9종과 Noto Sans KR의 유니코드 서브셋 수백 개가 모두 빌드
        // 산출물에 있기 때문이다. 폰트는 아래 runtimeCaching으로 실제 쓰인 것만
        // 담고, 예배 준비 화면이 세트에 쓰인 글꼴을 미리 불러 캐시를 데운다.
        globPatterns: ["**/*.{js,css,html,ico,svg,webmanifest}", "icons/*.png"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // 이게 없으면 네트워크가 끊긴 상태에서 /present/... 새로고침 시 앱이 뜨지 않는다.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 번들 웹폰트 (Pretendard, Noto Sans KR, Nanum Myeongjo).
            // 외부 CDN이 아니라 자체 오리진 /assets/ 에서 온다 (PRD 7.7).
            urlPattern: /\.(?:woff2?|ttf|otf|eot)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "worship-fonts-cache",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: new RegExp(`${MEDIA_URL_PREFIX}.*`, "i"),
            handler: "CacheFirst",
            options: {
              cacheName: MEDIA_CACHE_NAME,
              // = RangeRequestsPlugin. 캐시된 전체 응답을 잘라 206을 만들어
              // <video>의 구간 재생을 네트워크 없이 처리한다.
              rangeRequests: true,
              cacheableResponse: { statuses: [200, 206] },
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      devOptions: {
        // 개발 중 Service Worker가 붙으면 HMR과 캐시가 엉킨다.
        enabled: false,
      },
    }),
  ],
  build: { outDir: "dist" },
});
