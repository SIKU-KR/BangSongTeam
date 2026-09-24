import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const DB_IS_WORKER_ONLY =
  "src/db는 Worker 전용이다. 프론트엔드는 Hono RPC 클라이언트(lib/api)로 서버와 통신한다.";

const CLIENT_BOUNDARY = [
  { regex: "^#db(/|$)", message: DB_IS_WORKER_ONLY },
  { regex: "^(\\.\\./)+db(/|$)", message: DB_IS_WORKER_ONLY },
  {
    regex: "^(\\.\\./)+worker(/|$)",
    allowTypeImports: true,
    message:
      "Worker 코드를 SPA 번들에 넣지 않는다. 타입(AppType)만 `import type`으로 가져온다.",
  },
];

const ZERO_FETCH =
  "송출 화면은 API·데이터 요청 0건이어야 한다 (Zero-Fetch). 서버 캐시 훅과 API 클라이언트를 쓰지 않는다.";

/**
 * 한 배포 단위(Worker + SPA)를 단일 패키지로 두므로, 패키지 경계가 하던
 * 레이어 격리를 import 규칙으로 대신 강제한다.
 *
 * flat config는 같은 규칙의 옵션을 파일별로 '덮어쓴다'. 그래서 송출 파일 블록은
 * client 경계 목록을 다시 펼쳐 넣는다. 빼면 그 파일들에서 DB 격리가 풀린다.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
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
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "crypto",
          property: "randomUUID",
          message:
            "엔터티 id는 #shared의 createId()(NanoID)로 만드세요. UUID는 IdSchema를 통과하지 못합니다.",
        },
      ],
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: CLIENT_BOUNDARY },
      ],
    },
  },
  {
    files: [
      "src/client/routes/FullscreenPresentRoute.tsx",
      "src/client/features/presentation/**/*.{ts,tsx}",
      "src/client/components/stage/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@tanstack/react-query", message: ZERO_FETCH }],
          patterns: [
            ...CLIENT_BOUNDARY,
            { regex: "(^|/)lib/api(/|$)", message: ZERO_FETCH },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!(zod|nanoid|es-hangul)$|\\.\\.?/)",
              message:
                "src/shared는 브라우저·Worker 양쪽에서 도는 순수 TypeScript다. zod·nanoid·es-hangul 외의 모듈을 쓰지 않는다.",
            },
            {
              regex: "^(\\.\\./)+(client|worker|db)(/|$)",
              message: "src/shared는 다른 레이어를 import하지 않는다.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/db/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(\\.\\./)+(client/|worker(/|$))",
              message: "src/db는 #shared 외의 레이어를 import하지 않는다.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/worker/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(\\.\\./)+client/",
              message: "Worker는 SPA 코드를 import하지 않는다.",
            },
          ],
        },
      ],
    },
  },
);
