import { defineConfig, mergeConfig } from "vite";
import { defineConfig as defineVitestConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default mergeConfig(
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        // vite-plugin-pwa의 가상 모듈은 테스트 설정에 없다. 등록 동작은
        // 브라우저에서만 의미가 있으므로 no-op 대역으로 해석시킨다.
        "virtual:pwa-register": path.resolve(
          __dirname,
          "./src/test/stubs/pwaRegister.ts",
        ),
      },
    },
  }),
  defineVitestConfig({
    test: {
      name: "web-client",
      include: ["src/**/*.test.{ts,tsx}"],
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  }),
);
