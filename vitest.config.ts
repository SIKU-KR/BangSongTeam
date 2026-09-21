import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/web/vitest.config.ts",
      "apps/web/vitest.client.config.ts",
      {
        test: {
          name: "root",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
