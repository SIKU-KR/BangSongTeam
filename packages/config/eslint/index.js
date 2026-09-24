const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");

/**
 * Shared ESLint configuration for prj-ppt monorepo.
 * Enforces strict TypeScript linting and package isolation guardrails:
 * - packages/db is Worker-only.
 * - The frontend (apps/web/src) MUST NEVER import packages/db.
 */
module.exports = tseslint.config(
  // 1. Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/worker-configuration.d.ts",
    ],
  },
  // 2. JavaScript recommended rules
  js.configs.recommended,
  // 3. TypeScript recommended rules
  ...tseslint.configs.recommended,
  // 4. Node & CommonJS files settings
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // 5. TypeScript parser settings
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
  // 6. Architecture Guardrail: Strict DB Isolation
  // packages/db is Worker-only. The frontend (apps/web/src) MUST NEVER import packages/db.
  {
    files: [
      "apps/web/src/**/*.{ts,tsx,js,jsx}",
      "**/apps/web/src/**/*.{ts,tsx,js,jsx}",
      ...(process.cwd().includes("apps/web")
        ? ["src/**/*.{ts,tsx,js,jsx}"]
        : []),
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@repo/db",
              message:
                "packages/db is Worker-only. The frontend (apps/web/src) MUST NEVER import packages/db directly. Use Hono RPC Client instead.",
            },
          ],
          patterns: [
            {
              group: [
                "@repo/db",
                "@repo/db/*",
                "**/packages/db",
                "**/packages/db/**",
                "*packages/db*",
              ],
              message:
                "packages/db is Worker-only. The frontend (apps/web/src) MUST NEVER import packages/db directly. Use Hono RPC Client instead.",
            },
          ],
        },
      ],
    },
  },
  // 7. Architecture Guardrail: Zero-Fetch Projection (M4-5, M5-5)
  // 송출 화면(전체화면)과 그 화면이 쓰는 스테이지·송출 모듈은 서버 캐시
  // 계층(TanStack Query)과 API 클라이언트를 직접 import하지 않는다. 송출 중 네트워크
  // 요청 0건 불변식을 import 수준에서 막는다.
  //
  // flat config는 같은 규칙의 옵션을 파일별로 '덮어쓴다'. 그래서 위 6번의 @repo/db
  // 제한을 여기서도 반복한다 — 빼면 이 파일들에서 DB 격리가 풀린다.
  {
    files: [
      "**/apps/web/src/routes/FullscreenPresentRoute.tsx",
      "**/apps/web/src/features/presentation/**/*.{ts,tsx}",
      "**/apps/web/src/components/stage/**/*.{ts,tsx}",
      "apps/web/src/routes/FullscreenPresentRoute.tsx",
      "apps/web/src/features/presentation/**/*.{ts,tsx}",
      "apps/web/src/components/stage/**/*.{ts,tsx}",
      ...(process.cwd().includes("apps/web")
        ? [
            "src/routes/FullscreenPresentRoute.tsx",
            "src/features/presentation/**/*.{ts,tsx}",
            "src/components/stage/**/*.{ts,tsx}",
          ]
        : []),
    ],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@repo/db",
              message:
                "packages/db is Worker-only. The frontend (apps/web/src) MUST NEVER import packages/db directly. Use Hono RPC Client instead.",
            },
            {
              name: "@tanstack/react-query",
              message:
                "송출 화면은 네트워크 요청 0건이어야 한다 (Zero-Fetch). 서버 캐시 훅을 쓰지 않는다.",
            },
          ],
          patterns: [
            {
              group: [
                "@repo/db",
                "@repo/db/*",
                "**/packages/db",
                "**/packages/db/**",
                "*packages/db*",
              ],
              message:
                "packages/db is Worker-only. The frontend (apps/web/src) MUST NEVER import packages/db directly. Use Hono RPC Client instead.",
            },
            {
              regex: "(^|/)lib/api(/|$)",
              message:
                "송출 화면은 네트워크 요청 0건이어야 한다 (Zero-Fetch). API 클라이언트를 import하지 않는다.",
            },
          ],
        },
      ],
    },
  },
);
