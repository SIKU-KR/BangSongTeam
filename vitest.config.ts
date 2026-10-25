import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig, mergeConfig } from "vitest/config";

const rootDir = import.meta.dirname;

/**
 * 테스트 프로젝트 세 개: server(workerd + D1), client(jsdom), node(shared·db·config·scripts).
 * API 서버가 요청마다 남기는 구조화 로그(`requestLog`)가 테스트 출력을 덮지 않게 성공 요청
 * 줄만 숨긴다. 5xx 줄은 `console.error`라 그대로 보인다.
 */
export default defineConfig(async () => {
  // wrangler는 설정을 읽을 때 assets.directory(.open-next/assets)가 존재해야 하고, 없으면
  // 워커 테스트 풀이 "assets directory does not exist"로 뜨지 못한다. 내용은 OpenNext
  // 빌드가 채우지만 테스트는 빌드 전(CI, 새 클론)에도 돌아야 하므로 빈 디렉터리를 만든다.
  mkdirSync(path.resolve(rootDir, ".open-next/assets"), { recursive: true });

  // 손으로 쓴 CREATE TABLE 문자열 대신 실제 마이그레이션을 테스트 D1에 적용한다.
  // 설정 시점(Node)에 읽어 바인딩으로 넘기고, workerd 안에서는 setup이 적용한다.
  const migrations = await readD1Migrations(
    path.resolve(rootDir, "src/db/migrations"),
  );

  // @better-auth/telemetry의 exports에는 "node" 조건이 있고 그 진입점이 node:os를
  // import한다. workerd에는 node:os가 없어 모듈 로드 자체가 실패한다. "node" 조건으로
  // 뽑히는 dist/node.mjs 옆의 런타임 중립 진입점 dist/index.mjs로 직접 별칭을 건다.
  const nodeRequire = createRequire(import.meta.url);
  const telemetryNodeEntry = createRequire(
    nodeRequire.resolve("better-auth", { paths: [rootDir] }),
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

  const serverProject = defineConfig({
    plugins: [
      cloudflareTest({
        // 배포 진입점(`.open-next/worker.js`)은 빌드 산출물이라 테스트는 Hono 앱을 직접 쓴다.
        main: "./src/server/index.ts",
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
      name: "server",
      include: ["src/server/**/*.test.ts"],
      setupFiles: ["./src/server/test/setup.ts"],
      // 공유 D1을 사용하는 기존 순차 실행을 Vitest 4 설정으로 유지한다.
      // https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/
      maxWorkers: 1,
      sequence: { groupOrder: 1 },
      fileParallelism: false,
      isolate: false,
    },
  });

  const clientProject = mergeConfig(
    {
      plugins: [react()],
      resolve: {
        alias: {
          // Next.js 라우터는 앱 라우터 런타임 안에서만 동작한다. 테스트는 window.history로
          // 움직이는 대역을 쓴다(`src/client/test/next/*`).
          "next/navigation": path.resolve(
            rootDir,
            "src/client/test/next/navigation.ts",
          ),
          "next/link": path.resolve(rootDir, "src/client/test/next/link.tsx"),
        },
      },
    },
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

  return {
    test: {
      onConsoleLog: (log: string, type: "stdout" | "stderr") =>
        !(type === "stdout" && log.includes("event: 'request'")),
      projects: [
        serverProject,
        clientProject,
        {
          test: {
            name: "node",
            include: [
              "src/shared/**/*.test.ts",
              "src/db/**/*.test.ts",
              "config/**/*.test.ts",
              "scripts/**/*.test.ts",
            ],
            environment: "node",
          },
        },
      ],
    },
  };
});
