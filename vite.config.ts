import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import {
  MEDIA_CACHE_NAME,
  MEDIA_URL_PREFIX,
} from "./src/shared/constants/projection";

/**
 * 오프라인 송출 보장을 위한 PWA 구성.
 *
 * - `registerType: "prompt"`: 자동 갱신을 쓰지 않는다. 배포가 나간 순간 송출 중인
 *   페이지가 새로고침되면 예배가 끊긴다. 갱신은 사용자가 편집 화면에서 직접 누른다.
 * - `generateSW` 전략이므로 설정이 직렬화된다. 함수형 urlPattern과
 *   `new RangeRequestsPlugin()` 인스턴스는 injectManifest 전용이라 쓸 수 없고,
 *   선언형 등가 옵션(`rangeRequests`, `cacheableResponse`, `expiration`)으로 옮겼다.
 * - 배경 영상 캐시는 편집·송출 중 백그라운드 캐시(`src/client/lib/offline/mediaCache.ts`)가
 *   직접 써 넣는 캐시와 같아야 하므로, 이름과 경로를 공용 상수에서 가져온다.
 */
export default defineConfig({
  plugins: [
    react(),
    // 원격 바인딩은 기본으로 끈다. 켜 두면 `pnpm dev`가 `CLOUDFLARE_API_TOKEN`을
    // 요구할 수 있어 토큰이 없는 사람은 로컬 개발을 시작하지 못한다. 테스트 설정도
    // remoteBindings: false이므로 개발·테스트 동작이 같아진다.
    // 원격 리소스를 붙여야 하면 CF_REMOTE_BINDINGS=true로 실행한다.
    cloudflare({ remoteBindings: process.env.CF_REMOTE_BINDINGS === "true" }),
    VitePWA({
      registerType: "prompt",
      // 등록은 src/client/pwa/registerServiceWorker.ts에서 직접 한다 (갱신 시점 통제).
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
        // 송출 화면은 테마와 무관하게 항상 검정이다.
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
        // 담고, 세트를 열면 백그라운드 캐시가 가사에 쓰인 글꼴을 불러 캐시를 데운다.
        globPatterns: ["**/*.{js,css,html,ico,svg,webmanifest}", "icons/*.png"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // 이게 없으면 네트워크가 끊긴 상태에서 /present/... 새로고침 시 앱이 뜨지 않는다.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 번들 웹폰트 (Pretendard, Noto Sans KR, Nanum Myeongjo).
            // 외부 CDN이 아니라 자체 오리진 /assets/ 에서 온다.
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
              // 전체 응답(200)만 담는다. Cache API는 206을 저장하지 못해
              // (`cache.put`이 TypeError), 허용해 봐야 SW에서 에러만 난다.
              cacheableResponse: { statuses: [200] },
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
