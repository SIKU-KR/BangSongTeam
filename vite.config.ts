import { defineConfig, mergeConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ViteUserConfig } from "vitest/config";
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
const appConfig: UserConfig = {
  publicDir: "src/client/public",
  plugins: [
    react(),
    tailwindcss(),
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
};

/**
 * 테스트 프로젝트 세 개: worker(workerd + D1), client(jsdom), node(shared·db·config).
 * 루트의 설정 파일 수를 줄이려고 vitest 설정을 이 파일에 함께 둔다. vitest로 실행될
 * 때만 만들며, 이때는 앱 플러그인(cloudflare·PWA)을 싣지 않는다. 테스트 전용
 * 의존성은 `vite dev`·`vite build`가 불러오지 않도록 동적으로 import한다.
 */
async function createTestConfig(): Promise<
  UserConfig & Pick<ViteUserConfig, "test">
> {
  const { defineWorkersProject, readD1Migrations } =
    await import("@cloudflare/vitest-pool-workers/config");
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

  const workerProject = defineWorkersProject({
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
      // 외부 모듈로 남으면 workerd가 직접 해석하는데, nodejs_compat이 켜져 있어
      // "node" export 조건이 매칭된다. better-auth 계열은 번들에 포함시켜
      // 위의 워커 조건으로 해석되게 한다.
      deps: {
        optimizer: {
          ssr: {
            enabled: true,
            include: ["better-auth", "@better-auth/telemetry"],
          },
        },
      },
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          isolatedStorage: false,
          // 스토리지를 공유하므로 파일을 병렬로 돌리면 서로의 D1 상태를 밟는다
          // (sync.test.ts는 beforeEach에서 테이블을 비운다).
          singleWorker: true,
          remoteBindings: false,
          miniflare: {
            compatibilityFlags: ["nodejs_compat"],
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  });

  // vitest 3의 설정 타입은 Vite 7 기준이라 Vite 8용 react 플러그인을 바로 넣으면
  // 타입이 맞지 않는다. 플러그인 쪽은 Vite 설정으로 따로 만들어 합친다.
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

export default defineConfig(async (): Promise<UserConfig> =>
  process.env.VITEST ? await createTestConfig() : appConfig,
);
