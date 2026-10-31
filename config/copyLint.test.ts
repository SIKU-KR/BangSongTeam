import { describe, expect, it } from "vitest";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { copyPlugin } from "../eslint.config.mjs";

const linter = new Linter({ configType: "flat" });
const lintTsx = (code: string): (string | null)[] =>
  linter
    .verify(
      code,
      [
        {
          files: ["**/*.tsx"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { copy: copyPlugin as ESLint.Plugin },
          rules: { "copy/no-inline-copy": "error" },
        },
      ],
      "Example.tsx",
    )
    .map((message) => message.ruleId);

describe("copy/no-inline-copy", () => {
  it.each([
    ['const label = "저장";', "한글 문자열"],
    ["const label = `${name} 저장`;", "한글 템플릿"],
    ["const el = <p>저장</p>;", "한글 JSX 텍스트"],
    ["const el = <p>Save</p>;", "영어 JSX 텍스트"],
    ['const el = <p>{"Save"}</p>;', "JSX 자식 문자열"],
    ['const el = <nav aria-label="breadcrumb" />;', "영어 aria-label"],
    ['const el = <Input placeholder="Search" />;', "영어 placeholder"],
  ])("%s를 막는다 (%s)", (code) => {
    expect(lintTsx(code)).toEqual(["copy/no-inline-copy"]);
  });

  it.each([
    'const el = <p className="text-sm">{COPY.save}</p>;',
    'const el = <div data-testid="save-btn" role="option" />;',
    'const el = <Button variant="outline" size="sm">{COPY.save}</Button>;',
    'const key = "presentation-pull";',
    "const el = <span aria-hidden>·</span>;",
  ])("%s는 통과한다", (code) => {
    expect(lintTsx(code)).toEqual([]);
  });
});

describe("문구 규칙 적용 범위", () => {
  const eslint = new ESLint();
  const severityFor = async (file: string): Promise<unknown> => {
    const config = (await eslint.calculateConfigForFile(file)) as {
      rules?: Record<string, unknown>;
    };
    const entry = config.rules?.["copy/no-inline-copy"];
    return Array.isArray(entry) ? entry[0] : entry;
  };

  it.each([
    "src/client/routes/LoginRoute.tsx",
    "src/client/routes/PrivacyRoute.tsx",
    "src/client/routes/TermsRoute.tsx",
    "src/client/components/ui/dialog.tsx",
    "src/client/features/editor/ribbon/FontControls.tsx",
    "src/server/routes/auth.ts",
    "src/app/layout.tsx",
  ])("%s에 켜져 있다", async (file) => {
    expect(await severityFor(file)).toBe(2);
  });

  it.each(["src/client/copy/editor.ts", "src/shared/copy/apiErrors.ts"])(
    "copy 모듈 %s에는 꺼져 있다",
    async (file) => {
      expect(await severityFor(file)).toBeUndefined();
    },
  );
});
