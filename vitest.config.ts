import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vitest/config";

const rootDir = import.meta.dirname;

/**
 * 테스트 프로젝트 세 개: server(Node + Firestore 에뮬레이터: API·DB), client(jsdom),
 * node(shared·config·scripts). 에뮬레이터는 `config/firestoreEmulator.ts`가 준비한다.
 * API 서버가 요청마다 남기는 구조화 로그(`requestLog`)가 테스트 출력을 덮지 않게 성공 요청
 * 줄만 숨긴다. 5xx 줄은 `console.error`라 그대로 보인다.
 */
export default defineConfig({
  test: {
    onConsoleLog: (log: string, type: "stdout" | "stderr") =>
      !(type === "stdout" && log.includes('"event":"request"')),
    projects: [
      {
        test: {
          name: "server",
          include: ["src/server/**/*.test.ts", "src/db/**/*.test.ts"],
          environment: "node",
          globalSetup: ["./config/firestoreEmulator.ts"],
          setupFiles: ["./config/firestoreEmulatorEnv.ts"],
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
      mergeConfig(
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
              "next/link": path.resolve(
                rootDir,
                "src/client/test/next/link.tsx",
              ),
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
      ),
      {
        test: {
          name: "node",
          include: [
            "src/shared/**/*.test.ts",
            "config/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
          environment: "node",
        },
      },
    ],
  },
});
