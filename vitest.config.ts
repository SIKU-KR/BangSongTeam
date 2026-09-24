import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "./vitest.worker.config.ts",
      "./vitest.client.config.ts",
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
