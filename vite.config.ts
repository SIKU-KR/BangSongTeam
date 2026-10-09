import {
  defineConfig,
  mergeConfig,
  type ConfigEnv,
  type UserConfig,
} from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ViteUserConfig } from "vitest/config";
import {
  CDN_FONT_CACHE_NAME,
  CDN_FONT_STYLESHEET_CACHE_NAME,
  CDN_FONT_STYLESHEET_PATTERN,
  CDN_FONT_URL_PATTERN,
  MEDIA_CACHE_NAME,
  MEDIA_URL_PREFIX,
  POSTER_CACHE_NAME,
  POSTER_URL_PREFIX,
} from "./src/shared/constants/projection";
import { APP_NAME, APP_TAGLINE } from "./src/shared/copy/app";
import { BACKGROUND_INDEX_NAMES } from "./src/shared/utils/backgroundEmbedding";

/**
 * 오프라인 송출 보장을 위한 PWA 구성.
 *
 * - `registerType: "prompt"`: 자동 갱신을 쓰지 않는다. 배포가 나간 순간 송출 중인
 *   페이지가 새로고침되면 예배가 끊긴다. 새 버전은 사용자가 송출 화면이 아닌 곳을
 *   새로고침할 때 적용한다 (`src/client/pwa/registerServiceWorker.ts`).
 * - `generateSW` 전략이므로 설정이 직렬화된다. 함수형 urlPattern과
 *   `new RangeRequestsPlugin()` 인스턴스는 injectManifest 전용이라 쓸 수 없고,
 *   선언형 등가 옵션(`rangeRequests`, `cacheableResponse`, `expiration`)으로 옮겼다.
 * - 배경 영상 캐시는 편집·송출 중 백그라운드 캐시(`src/client/lib/offline/mediaCache.ts`)가
 *   직접 써 넣는 캐시와 같아야 하므로, 이름과 경로를 공용 상수에서 가져온다.
 * - `clientsClaim`: 처음 설치된 SW가 곧바로 지금 페이지를 제어해 첫 방문에도 배경
 *   영상을 캐시본으로 재생한다. 갱신은 `prompt`라 사용자가 새로고침할 때만 SW가 바뀐다.
 * - `VITE_APP_VERSION`: 클라이언트 실패 보고에 실을 앱 버전. CI 빌드는 커밋 SHA 앞 7자리,
 *   그 밖에서는 `dev`다.
 * - dev 서버는 배경 Vectorize 인덱스를 로컬용으로 바꾼다. 로컬 D1의 배경 id는 운영
 *   인덱스에 없다. 빌드 산출물(배포 설정)은 운영 인덱스를 그대로 쓴다.
 */
const createAppConfig = ({ command }: ConfigEnv): UserConfig => ({
  publicDir: "src/client/public",
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      process.env.GITHUB_SHA?.slice(0, 7) ?? "dev",
    ),
  },
  plugins: [
    react(),
    tailwindcss(),
    // 원격 바인딩은 기본으로 끈다. 켜 두면 `pnpm dev`가 `CLOUDFLARE_API_TOKEN`을
    // 요구할 수 있어 토큰이 없는 사람은 로컬 개발을 시작하지 못한다. 테스트 설정도
    // remoteBindings: false이므로 개발·테스트 동작이 같아진다.
    // 원격 리소스를 붙여야 하면 CF_REMOTE_BINDINGS=true로 실행한다.
    cloudflare({
      remoteBindings: process.env.CF_REMOTE_BINDINGS === "true",
      // 돌려준 값은 defu로 합쳐져 배열이 이어 붙는다(바인딩이 둘이 된다). 그래서 직접 고친다.
      config: (worker) => {
        if (command !== "serve") return;
        for (const index of worker.vectorize) {
          index.index_name = BACKGROUND_INDEX_NAMES.local;
        }
      },
    }),
    VitePWA({
      registerType: "prompt",
      // 등록은 src/client/pwa/registerServiceWorker.ts에서 직접 한다 (갱신 시점 통제).
      injectRegister: null,
      includeAssets: ["icons/*.png"],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_TAGLINE,
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
        // 앱 셸만 프리캐시한다. 폰트를 여기 넣으면 수십 MB짜리 설치가 된다 —
        // Pretendard·Noto Sans KR·나눔명조의 유니코드 서브셋 수백 개가 모두 빌드
        // 산출물에 있기 때문이다. 번들 글꼴과 눈누 카탈로그의 CDN 글꼴 모두 아래
        // runtimeCaching으로 실제 쓰인 것만 담고, 세트를 열면 백그라운드 캐시가
        // 가사에 쓰인 글꼴을 불러 캐시를 데운다.
        globPatterns: ["**/*.{js,css,html,ico,svg,webmanifest}", "icons/*.png"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // 이게 없으면 네트워크가 끊긴 상태에서 /present/... 새로고침 시 앱이 뜨지 않는다.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // 눈누 카탈로그 글꼴 CSS (jsDelivr, Google Fonts 등 외부 CDN).
            // <link>로 붙인 CSS는 불투명 응답(status 0)이라 오류 응답도 그대로 담긴다.
            // 캐시본으로 바로 그리되 온라인이면 뒤에서 다시 받아, 한 번 담긴 오류가
            // 다음 로드에서 바뀌게 한다.
            urlPattern: CDN_FONT_STYLESHEET_PATTERN,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: CDN_FONT_STYLESHEET_CACHE_NAME,
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            // 눈누 카탈로그 글꼴 파일. Workbox는 다른 출처 URL을 정규식이 첫 글자부터
            // 맞을 때만 처리하므로 아래 확장자 규칙으로는 잡히지 않는다. 패턴은 공용
            // 상수에서 가져온다. @font-face 요청은 CORS라 실제 상태 코드가 보이므로
            // 200만 담는다. Google CSS 하나가 유니코드 서브셋 100개 안팎으로
            // 펼쳐지므로 한도를 넉넉히 둔다.
            // purgeOnQuotaError를 켜지 않는다. 배경 영상 저장이 용량 오류를 내면 모든
            // 런타임 캐시의 콜백이 불려 송출 글꼴 캐시가 통째로 지워진다.
            urlPattern: CDN_FONT_URL_PATTERN,
            handler: "CacheFirst",
            options: {
              cacheName: CDN_FONT_CACHE_NAME,
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 1000,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            // 번들 웹폰트 (Pretendard, Noto Sans KR, Nanum Myeongjo).
            // 자체 오리진 /assets/ 에서 온다. 확장자만 보는 이 규칙은 같은 출처에만
            // 맞는다. 서브셋 파일은 Pretendard Variable 92개, Noto Sans KR 248개,
            // 나눔명조 184개다.
            // 한도가 이보다 작으면 가사에 쓴 서브셋이 밀려나 오프라인 송출에서
            // 대체 글꼴로 나올 수 있으므로 전부 담을 수 있게 둔다.
            urlPattern: /\.(?:woff2?|ttf|otf|eot)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "worship-fonts-cache",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 600,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            // 글꼴 드롭다운 미리보기 이미지 (1,163장). 프리캐시하면 설치 때 전부 받으므로
            // 본 것만 담는다. 드롭다운을 다시 열 때 재검증 요청 수십 건이 나가지 않는다.
            urlPattern: /\/font-previews\/[^/]+\.webp$/,
            handler: "CacheFirst",
            options: {
              cacheName: "worship-font-previews-cache",
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 1500,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            // 포스터는 영상보다 먼저 맞춰 따로 담는다. 라이브러리를 훑으며 쌓이는
            // 포스터가 영상 캐시를 밀어내지 않게 하기 위해서다.
            urlPattern: new RegExp(POSTER_URL_PREFIX, "i"),
            handler: "CacheFirst",
            options: {
              cacheName: POSTER_CACHE_NAME,
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: new RegExp(MEDIA_URL_PREFIX, "i"),
            handler: "CacheFirst",
            options: {
              cacheName: MEDIA_CACHE_NAME,
              // = RangeRequestsPlugin. 캐시된 전체 응답을 잘라 206을 만들어
              // <video>의 구간 재생을 네트워크 없이 처리한다.
              rangeRequests: true,
              // 전체 응답(200)만 담는다. Cache API는 206을 저장하지 못해
              // (`cache.put`이 TypeError), 허용해 봐야 SW에서 에러만 난다.
              cacheableResponse: { statuses: [200] },
              // 개수·기간 한도는 두지 않는다. 용량은 앱이 바이트 기준으로 관리한다
              // (`ensureMediaSpace`).
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
  environments: {
    // Worker 환경(이름은 wrangler `name`의 `-`를 `_`로 바꾼 것)은 SSR 빌드라 기본으로
    // 압축하지 않는다. 콜드 스타트 때 파싱할 코드를 줄이려고 압축하고, 운영 로그의
    // 스택 트레이스를 읽을 수 있게 소스맵을 함께 올린다(wrangler `upload_source_maps`).
    bangsongteam: { build: { minify: true, sourcemap: true } },
  },
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        // 앱 코드만 바뀐 배포에서 벤더 청크를 다시 받지 않도록 따로 둔다.
        // Base UI는 편집기에서만 쓰는 부품이 많아 entriesAware로 라우트별로 나눈다.
        // 한 청크로 묶으면 로그인 화면이 편집기의 메뉴·셀렉트까지 받는다.
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
              priority: 2,
            },
            {
              name: "vendor-base-ui",
              test: /[\\/]node_modules[\\/](@base-ui|@floating-ui)[\\/]/,
              entriesAware: true,
              priority: 1,
            },
          ],
        },
      },
    },
  },
});

/**
 * 테스트 프로젝트 세 개: worker(workerd + D1), client(jsdom), node(shared·db·config).
 * 루트의 설정 파일 수를 줄이려고 vitest 설정을 이 파일에 함께 둔다. vitest로 실행될
 * 때만 만들며, 이때는 앱 플러그인(cloudflare·PWA)을 싣지 않는다. 테스트 전용
 * 의존성은 `vite dev`·`vite build`가 불러오지 않도록 동적으로 import한다.
 * Worker가 요청마다 남기는 구조화 로그(`requestLog`)가 테스트 출력을 덮지 않게 성공 요청
 * 줄만 숨긴다. 5xx 줄은 `console.error`라 그대로 보인다.
 */
async function createTestConfig(): Promise<
  UserConfig & Pick<ViteUserConfig, "test">
> {
  const { cloudflareTest, readD1Migrations } =
    await import("@cloudflare/vitest-plugin");
  const { defineConfig: defineVitestConfig } = await import("vitest/config");

  // wrangler는 설정을 읽을 때 assets.directory(./dist/client)가 존재해야 하고, 없으면
  // 워커 테스트 풀이 "assets directory does not exist"로 뜨지 못한다. 내용은
  // `vite build`가 채우지만 테스트는 빌드 전(CI, 새 클론)에도 돌아야 하므로 빈
  // 디렉터리를 만들어 둔다.
  mkdirSync(path.resolve(__dirname, "dist/client"), { recursive: true });

  // 손으로 쓴 CREATE TABLE 문자열 대신 실제 마이그레이션을 테스트 D1에 적용한다.
  // 설정 시점(Node)에 읽어 바인딩으로 넘기고, workerd 안에서는 setup이 적용한다.
  const migrations = await readD1Migrations(
    path.resolve(__dirname, "src/db/migrations"),
  );

  // @better-auth/telemetry의 exports에는 "node" 조건이 있고 그 진입점이 node:os를
  // import한다. workerd에는 node:os가 없어 모듈 로드 자체가 실패한다. "node" 조건으로
  // 뽑히는 dist/node.mjs 옆의 런타임 중립 진입점 dist/index.mjs로 직접 별칭을 건다.
  const nodeRequire = createRequire(import.meta.url);
  const telemetryNodeEntry = createRequire(
    nodeRequire.resolve("better-auth", { paths: [__dirname] }),
  ).resolve("@better-auth/telemetry");
  const telemetryEntry = path.join(
    path.dirname(telemetryNodeEntry),
    "index.mjs",
  );

  // 풀 플러그인은 resolve.conditions에서 "node"를 빼 주지만 ssr.resolve.conditions는
  // 건드리지 않는다. 루트 vitest가 워커 설정을 project로 불러오면 SSR 해석 경로에서
  // "node" 조건이 살아남아 telemetry의 node 진입점이 뽑힌다. 두 경로를 모두 막는다.
  const workerConditions = [
    "workerd",
    "worker",
    "browser",
    "import",
    "default",
  ];

  const workerProject = defineVitestConfig({
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        remoteBindings: false,
        miniflare: {
          compatibilityFlags: [
            "nodejs_compat",
            // 다중 microtask에서 처리된 인증 오류를 미처리 오류로 오인하지 않게 한다.
            // https://developers.cloudflare.com/workers/configuration/compatibility-flags/#defer-unhandled-rejection-processing-to-after-microtask-checkpoint
            "unhandled_rejection_after_microtask_checkpoint",
          ],
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    resolve: {
      alias: { "@better-auth/telemetry": telemetryEntry },
      conditions: workerConditions,
    },
    ssr: {
      target: "webworker",
      resolve: {
        conditions: workerConditions,
        externalConditions: workerConditions,
      },
    },
    test: {
      name: "worker",
      include: ["src/worker/**/*.test.ts"],
      setupFiles: ["./src/worker/test/setup.ts"],
      // 공유 D1을 사용하는 기존 순차 실행을 Vitest 4 설정으로 유지한다.
      // https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/
      maxWorkers: 1,
      fileParallelism: false,
      isolate: false,
    },
  });

  const clientProject = mergeConfig(
    {
      plugins: [react()],
      resolve: {
        alias: {
          // vite-plugin-pwa의 가상 모듈은 테스트 설정에 없다. 등록 동작은
          // 브라우저에서만 의미가 있으므로 no-op 대역으로 해석시킨다.
          "virtual:pwa-register": path.resolve(
            __dirname,
            "./src/client/test/stubs/pwaRegister.ts",
          ),
        },
      },
    },
    defineVitestConfig({
      test: {
        name: "client",
        include: ["src/client/**/*.test.{ts,tsx}"],
        environment: "jsdom",
        globals: true,
        setupFiles: ["./src/client/test/setup.ts"],
      },
    }),
  );

  const { test } = defineVitestConfig({
    test: {
      onConsoleLog: (log, type) =>
        !(type === "stdout" && log.includes("event: 'request'")),
      projects: [
        workerProject,
        clientProject,
        {
          test: {
            name: "node",
            include: [
              "src/shared/**/*.test.ts",
              "src/db/**/*.test.ts",
              "config/**/*.test.ts",
            ],
            environment: "node",
          },
        },
      ],
    },
  });
  return { test };
}

export default defineConfig(async (env): Promise<UserConfig> =>
  process.env.VITEST ? await createTestConfig() : createAppConfig(env),
);
