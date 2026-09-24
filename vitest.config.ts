import {
  defineWorkersProject,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
import react from "@vitejs/plugin-react";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig as defineViteConfig, mergeConfig } from "vite";
import { defineConfig } from "vitest/config";

// wrangler는 설정을 읽을 때 assets.directory(./dist/client)가 존재해야 하고, 없으면
// 워커 테스트 풀이 "assets directory does not exist"로 뜨지 못한다. 내용은
// `vite build`가 채우지만 테스트는 빌드 전(CI, 새 클론)에도 돌아야 하므로 빈
// 디렉터리를 만들어 둔다. (.gitkeep은 vite build가 outDir을 비울 때 지워진다)
mkdirSync(path.resolve(__dirname, "dist/client"), { recursive: true });

// 손으로 쓴 CREATE TABLE 문자열 대신 실제 마이그레이션을 테스트 D1에 적용한다.
// 설정 시점(Node)에 읽어 바인딩으로 넘기고, workerd 안에서는 setup이 적용한다.
const migrations = await readD1Migrations(
  path.resolve(__dirname, "migrations"),
);

// @better-auth/telemetry의 exports에는 "node" 조건이 있고 그 진입점이 node:os를
// import한다. workerd에는 node:os가 없어 모듈 로드 자체가 실패한다.
// 루트 vitest가 워커 설정을 project로 불러올 때 "node" 조건이 먼저 걸리므로,
// 런타임에 안전한 기본 진입점으로 직접 별칭을 건다.
const nodeRequire = createRequire(import.meta.url);
// "node" 조건으로 뽑히는 dist/node.mjs 옆에 런타임 중립 진입점 dist/index.mjs가 있다.
const telemetryNodeEntry = createRequire(
  nodeRequire.resolve("better-auth", { paths: [__dirname] }),
).resolve("@better-auth/telemetry");
const telemetryEntry = path.join(path.dirname(telemetryNodeEntry), "index.mjs");

// 풀 플러그인은 resolve.conditions에서 "node"를 빼 주지만 ssr.resolve.conditions는
// 건드리지 않는다. 루트 vitest가 워커 설정을 project로 불러오면 SSR 해석 경로에서
// "node" 조건이 살아남아 telemetry의 node 진입점이 뽑힌다. 두 경로를 모두 막는다.
const WORKER_CONDITIONS = ["workerd", "worker", "browser", "import", "default"];

const workerProject = defineWorkersProject({
  resolve: {
    alias: { "@better-auth/telemetry": telemetryEntry },
    conditions: WORKER_CONDITIONS,
  },
  ssr: {
    target: "webworker",
    resolve: {
      conditions: WORKER_CONDITIONS,
      externalConditions: WORKER_CONDITIONS,
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
// 타입이 맞지 않는다. 플러그인 쪽은 Vite의 defineConfig로 따로 만들어 합친다.
const clientProject = mergeConfig(
  defineViteConfig({
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
  }),
  defineConfig({
    test: {
      name: "client",
      include: ["src/client/**/*.test.{ts,tsx}"],
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/client/test/setup.ts"],
    },
  }),
);

/**
 * 테스트 프로젝트 세 개: worker(workerd + D1), client(jsdom), node(shared·db·tests).
 * 한 파일에 두는 이유는 루트의 설정 파일 수를 줄이기 위해서다.
 */
export default defineConfig({
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
            "tests/**/*.test.ts",
          ],
          environment: "node",
        },
      },
    ],
  },
});
