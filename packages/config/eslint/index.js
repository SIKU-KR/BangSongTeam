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
);
