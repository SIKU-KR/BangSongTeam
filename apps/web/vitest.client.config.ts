import { defineConfig, mergeConfig } from "vite";
import { defineConfig as defineVitestConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default mergeConfig(
  defineConfig({
    plugins: [react()],
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
