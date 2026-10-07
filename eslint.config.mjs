import js from "@eslint/js";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
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

const CLASS_MERGE_IMPORTS = [
  {
    regex: "^(clsx|tailwind-merge|classnames)$",
    message: "클래스 합성은 `cn`(패키지 `cn`)으로 한다.",
  },
];

const UI_IMPORTS = [
  ...ICON_IMPORTS,
  { regex: "^(@base-ui/|@radix-ui/)", message: UI_PRIMITIVES_ONLY_IN_UI },
  ...CLASS_MERGE_IMPORTS,
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
  "src/client/features/editor/ribbon/FontFamilySelect.tsx",
  "src/client/features/editor/ribbon/BackgroundControls.tsx",
  "src/client/features/editor/ColorPalette.tsx",
  "src/client/features/drive/DriveBrowser.tsx",
];

/**
 * 타입 정보로 불필요한 조건을 잡는 규칙에서 뺄 파일. 테스트는 픽스처를 인덱스로 꺼내므로
 * `noUncheckedIndexedAccess` 없이 검사해 인덱스 방어가 불필요해 보이고, `components/ui`는
 * shadcn CLI가 만든 그대로 둔다.
 */
const UNNECESSARY_CONDITION_EXEMPT_FILES = [
  "**/*.test.{ts,tsx}",
  "src/**/test/**",
  "src/db/test-utils.ts",
  "src/client/components/ui/**",
];

const ROUTE_FACTORY_ONLY =
  "라우트는 routes/<name>.ts에서 create<Name>Route 팩토리 하나로 export하세요.";

/**
 * Worker 라우트는 한 방식으로만 정의하고 마운트한다. 그래야 index.ts가 마운트 목록으로만
 * 읽히고, 라우트가 마운트 경로를 몰라 경로를 옮겨도 라우트 안을 고치지 않는다.
 */
const WORKER_ROUTE_MODULE_SYNTAX = [
  {
    selector: "ExportNamedDeclaration > VariableDeclaration",
    message: ROUTE_FACTORY_ONLY,
  },
  {
    selector:
      "ExportNamedDeclaration > FunctionDeclaration[id.name!=/^create[A-Z]\\w*Route$/]",
    message: ROUTE_FACTORY_ONLY,
  },
  {
    selector: "Literal[value=/^\\/api(\\/|$)/]",
    message:
      "라우트 안 경로는 마운트 지점 기준 상대 경로로 쓰세요. 마운트 경로는 index.ts가 정합니다.",
  },
];
const WORKER_APP_SYNTAX = [
  {
    selector:
      "CallExpression[callee.property.name=/^(get|post|put|patch|delete|all|on)$/]",
    message:
      "핸들러는 routes/에 팩토리로 두고 index.ts에서는 .route()로 마운트만 하세요.",
  },
];

const HANGUL = /[가-힣]/;
const COPY_IN_COPY_MODULES =
  "사용자에게 보이는 문구는 src/client/copy/*(클라이언트)나 src/shared/copy/*(서버·검증)에 두고 가져다 쓰세요. 같은 문장이 이미 있으면 그 키를 재사용합니다.";

/**
 * 한국어 문자열·JSX 텍스트를 copy 모듈 밖에서 쓰지 못하게 한다. 같은 문장이
 * 여러 파일에 흩어지면 한쪽만 고쳐져 어긋난다. `no-restricted-syntax`는 파일별로
 * 덮어써져 UI_SYNTAX 블록과 겹치므로 별도 규칙으로 둔다.
 */
const copyPlugin = {
  rules: {
    "no-inline-copy": {
      meta: { type: "suggestion", schema: [] },
      create(context) {
        const report = (node) =>
          context.report({ node, message: COPY_IN_COPY_MODULES });
        return {
          Literal(node) {
            if (typeof node.value === "string" && HANGUL.test(node.value)) {
              report(node);
            }
          },
          TemplateElement(node) {
            if (HANGUL.test(node.value.raw)) report(node);
          },
          JSXText(node) {
            if (HANGUL.test(node.value)) report(node);
          },
        };
      },
    },
  },
};

/** 문구가 아닌 데이터(글꼴 이름, 샘플 가사, 분위기 태그 값, 개발용 시드)와 조문 본문 */
const COPY_EXEMPT_FILES = [
  "src/shared/constants/noonnuFontCatalog.ts",
  "src/shared/constants/noonnuFonts.ts",
  "src/shared/constants/backgrounds.ts",
  "src/shared/constants/devUsers.ts",
  "src/db/seed/devSeed.ts",
  "src/client/routes/TermsRoute.tsx",
  "src/client/routes/PrivacyRoute.tsx",
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
      ".claude/**",
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
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "error",
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
    files: UNNECESSARY_CONDITION_EXEMPT_FILES,
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/copy/**",
      "**/*.test.{ts,tsx}",
      "src/**/test/**",
      "src/client/components/ui/**",
      ...COPY_EXEMPT_FILES,
    ],
    plugins: { copy: copyPlugin },
    rules: {
      "copy/no-inline-copy": "error",
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
  /**
   * 접근성 린트(WCAG 2.2 AA). `#components/ui` 래퍼는 DOM이 아니라서 autoFocus 검사에서
   * 빠진다. 이름 바꾸기처럼 사용자가 연 편집 필드에만 쓴다.
   *
   * Base UI `render={<a … />}`는 링크 내용을 부모 컴포넌트의 children으로 받아
   * 정적 분석으로는 비어 보이므로 `anchor-has-content`를 끈다.
   */
  {
    files: ["src/client/**/*.tsx"],
    ignores: ["**/*.test.tsx", "src/client/components/ui/**"],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/anchor-has-content": "off",
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
    },
  },
  {
    files: ["src/client/**/*.tsx"],
    ignores: ["**/*.test.tsx", "src/client/components/ui/**"],
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
  /**
   * 소셜 로그인 버튼은 브랜드 가이드가 색·모서리·글꼴을 고정해 shadcn Button의 기본
   * 스타일(rounded-lg 등)을 덮어써야 한다. `cn`이 사용자 정의 모서리 토큰의 충돌을 풀지
   * 못하므로 이 파일만 Button 프리미티브를 직접 쓴다.
   */
  {
    files: ["src/client/features/auth/SocialLoginButton.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            ...CLIENT_BOUNDARY,
            ...ICON_IMPORTS,
            ...CLASS_MERGE_IMPORTS,
            {
              regex: "^(@base-ui/(?!react/button$)|@radix-ui/)",
              message: UI_PRIMITIVES_ONLY_IN_UI,
            },
          ],
        },
      ],
    },
  },
  /**
   * 드라이브 목록 행(role="option")은 포커스를 받지만 키보드 조작(↑↓·Space·Enter…)은
   * useDriveKeyboard가 창 단위로 받는다. 행마다 키 핸들러를 달 필요가 없다.
   */
  {
    files: ["src/client/features/drive/DriveItems.tsx"],
    rules: {
      "jsx-a11y/click-events-have-key-events": "off",
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
  {
    files: ["src/worker/routes/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...WORKER_ROUTE_MODULE_SYNTAX],
    },
  },
  {
    files: ["src/worker/index.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...WORKER_APP_SYNTAX],
    },
  },
);
