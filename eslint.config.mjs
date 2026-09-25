import js from "@eslint/js";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
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

const UI_PRIMITIVES_ONLY_IN_UI =
  "프리미티브는 src/client/components/ui의 shadcn 래퍼로만 쓴다. `#components/ui/*`를 import하세요.";
const ICONS_ARE_LUCIDE =
  "아이콘은 lucide-react만 쓴다. 인라인 SVG나 다른 아이콘 패키지를 쓰지 않는다.";

const ICON_IMPORTS = [
  {
    regex:
      "^(react-icons|@heroicons/|@radix-ui/react-icons|@tabler/icons|@phosphor-icons/|hugeicons|@remixicon/)",
    message: ICONS_ARE_LUCIDE,
  },
];

const UI_IMPORTS = [
  ...ICON_IMPORTS,
  { regex: "^(@base-ui/|@radix-ui/)", message: UI_PRIMITIVES_ONLY_IN_UI },
  {
    regex: "^(clsx|tailwind-merge|classnames)$",
    message: "클래스 합성은 `cn`(패키지 `cn`)으로 한다.",
  },
];

const ZERO_FETCH =
  "송출 화면은 API·데이터 요청 0건이어야 한다 (Zero-Fetch). 서버 캐시 훅과 API 클라이언트를 쓰지 않는다.";

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/**
 * 색·다크 모드·크기는 index.css의 토큰이 정한다. 기능 코드가 팔레트 색이나
 * `dark:`를 직접 쓰면 테마마다 짝을 맞춰야 하고, 임의값은 스케일을 벗어난다.
 */
const TAILWIND_RESTRICTIONS = [
  {
    pattern: `^(.*:)?(bg|text|border|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|decoration|caret|accent|shadow)-(${PALETTE})-\\d+(\\/\\d+)?$`,
    message:
      "팔레트 색 대신 의미 토큰(bg-muted, text-muted-foreground, bg-primary, text-destructive …)을 쓰세요.",
  },
  {
    pattern: "^(.*:)?dark:",
    message: "`dark:` 대신 다크 모드를 스스로 처리하는 토큰을 쓰세요.",
  },
  {
    pattern: "\\[([^\\[\\]]*?)\\](?!:)",
    message:
      "임의값 대신 Tailwind 스케일이나 index.css의 `@theme` 토큰을 쓰세요.",
  },
];

const RAW_ELEMENTS = {
  selector:
    "JSXOpeningElement[name.name=/^(button|input|textarea|select|svg)$/]",
  message:
    "기본 요소 대신 #components/ui의 Button·Input·Textarea·Select, 아이콘은 lucide-react를 쓰세요.",
};
const HAND_ROLLED_OVERLAYS = {
  selector:
    "JSXAttribute[name.name='role'][value.value=/^(dialog|alertdialog|menu|menuitem|menuitemradio|menuitemcheckbox|tooltip)$/]",
  message:
    "직접 만든 오버레이 대신 Dialog·AlertDialog·DropdownMenu·Popover·Tooltip을 쓰세요.",
};
const NATIVE_TOOLTIP = {
  selector:
    "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
  message: "네이티브 title 툴팁 대신 #components/ui/tooltip을 쓰세요.",
};
const INLINE_STYLE = {
  selector:
    "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='style']",
  message:
    "인라인 style 대신 Tailwind 클래스를 쓰세요. 송출 스테이지처럼 사용자 값을 그려야 하는 파일만 허용 목록에 둡니다.",
};
const UI_SYNTAX = [RAW_ELEMENTS, HAND_ROLLED_OVERLAYS, NATIVE_TOOLTIP];

/**
 * StageLyricsEditor의 textarea는 송출 텍스트 박스의 글꼴·줄 간격을 그대로
 * 물려받아야 하므로 Textarea 대신 기본 요소를 쓴다 (아래 전용 블록).
 *
 * 사용자가 정한 글꼴·색·좌표(%)를 그리는 '콘텐츠'와 드래그·드래그 선택 좌표를 쓰는 파일.
 * 편집 화면과 송출 화면의 픽셀이 같아야 하므로 인라인 style을 허용한다.
 */
const STYLE_ALLOWED_FILES = [
  "src/client/components/stage/**/*.tsx",
  "src/client/routes/FullscreenPresentRoute.tsx",
  "src/client/features/editor/EditorStageCanvas.tsx",
  "src/client/features/editor/StageLyricsEditor.tsx",
  "src/client/features/editor/ribbon/FontControls.tsx",
  "src/client/features/editor/SortableList.tsx",
  "src/client/features/drive/DriveBrowser.tsx",
];

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
    ignores: ["src/client/components/ui/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [...CLIENT_BOUNDARY, ...UI_IMPORTS] },
      ],
    },
  },
  {
    files: ["src/client/components/ui/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [...CLIENT_BOUNDARY, ...ICON_IMPORTS] },
      ],
    },
  },
  {
    files: ["src/client/**/*.tsx"],
    ignores: ["**/*.test.tsx"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": { entryPoint: "src/client/index.css" },
    },
    rules: {
      ...betterTailwindcss.configs["recommended-error"].rules,
      "better-tailwindcss/enforce-consistent-line-wrapping": "off",
    },
  },
  {
    files: ["src/client/**/*.tsx"],
    ignores: ["**/*.test.tsx", "src/client/components/ui/**"],
    rules: {
      "better-tailwindcss/no-restricted-classes": [
        "error",
        { restrict: TAILWIND_RESTRICTIONS },
      ],
      "no-restricted-syntax": ["error", ...UI_SYNTAX, INLINE_STYLE],
    },
  },
  {
    files: STYLE_ALLOWED_FILES,
    ignores: ["**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...UI_SYNTAX],
    },
  },
  {
    files: ["src/client/features/editor/StageLyricsEditor.tsx"],
    rules: {
      "no-restricted-syntax": ["error", HAND_ROLLED_OVERLAYS, NATIVE_TOOLTIP],
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
            ...UI_IMPORTS,
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
