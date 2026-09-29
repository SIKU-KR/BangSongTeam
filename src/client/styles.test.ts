import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Global Styles & Local Pretendard Webfont Configuration", () => {
  const cssPath = path.resolve(__dirname, "index.css");
  const mainPath = path.resolve(__dirname, "main.tsx");

  it("should have index.css that imports local pretendard without external CDNs", () => {
    expect(fs.existsSync(cssPath)).toBe(true);
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    expect(cssContent).toMatch(/pretendard/);

    expect(cssContent).not.toMatch(/fonts\.googleapis\.com/);
    expect(cssContent).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(cssContent).not.toMatch(/cdnjs\.cloudflare\.com/);

    expect(cssContent).toMatch(/-webkit-font-smoothing:\s*antialiased/);
  });

  it("UI 글꼴은 dynamic subset으로 싣고, 가사용 번들 글꼴은 메인 CSS에 넣지 않는다", () => {
    const cssContent = fs.readFileSync(cssPath, "utf-8");
    expect(cssContent).toMatch(
      /@import "pretendard\/dist\/web\/variable\/pretendardvariable-dynamic-subset\.css"/,
    );
    expect(cssContent).not.toMatch(
      /pretendard\/dist\/web\/static\/pretendard\.css/,
    );
    expect(cssContent).not.toMatch(/@fontsource\//);
  });

  it("should import index.css in main.tsx", () => {
    const mainContent = fs.readFileSync(mainPath, "utf-8");
    expect(mainContent).toMatch(/import\s+['"].\/index\.css['"]/);
  });
});

type Srgb = [number, number, number];

interface Token {
  rgb: Srgb;
  alpha: number;
}

function oklchToSrgb(l: number, c: number, h: number): Srgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  return linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  }) as Srgb;
}

function readTokens(css: string, selector: string): Record<string, Token> {
  const start = css.indexOf(`\n${selector} {`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const tokens: Record<string, Token> = {};
  const pattern =
    /--([\w-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)/g;
  for (const [, name, l, c, h, alpha] of block.matchAll(pattern)) {
    tokens[name] = {
      rgb: oklchToSrgb(Number(l), Number(c), Number(h)),
      alpha: alpha ? Number(alpha) / 100 : 1,
    };
  }
  return tokens;
}

function over(fg: Token, bg: Srgb, alpha = fg.alpha): Srgb {
  return fg.rgb.map((v, i) => alpha * v + (1 - alpha) * bg[i]) as Srgb;
}

function luminance(rgb: Srgb): number {
  const [r, g, b] = rgb.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Srgb, b: Srgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "card"],
  ["muted-foreground", "sidebar"],
  ["destructive", "background"],
  ["warning", "background"],
  ["warning-foreground", "warning"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
];

describe.each([":root", ".dark"])("%s 토큰의 WCAG 2.2 AA 대비", (selector) => {
  const css = fs.readFileSync(path.resolve(__dirname, "index.css"), "utf-8");
  const tokens = readTokens(css, selector);
  const solid = (name: string): Srgb => {
    const bg = tokens.background.rgb;
    return over(tokens[name], bg);
  };

  it.each(TEXT_PAIRS)("글자 %s는 %s 위에서 4.5:1 이상이다", (fg, bg) => {
    expect(contrast(solid(fg), solid(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([0.1, 0.2])(
    "destructive 글자는 destructive/%s 배경 위에서 4.5:1 이상이다",
    (alpha) => {
      const tint = over(tokens.destructive, solid("background"), alpha);
      expect(contrast(solid("destructive"), tint)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["background", "muted", "card", "popover"])(
    "포커스 링(ring/50)은 %s 위에서 3:1 이상이다",
    (bg) => {
      const ring = over(tokens.ring, solid(bg), 0.5);
      expect(contrast(ring, solid(bg))).toBeGreaterThanOrEqual(3);
    },
  );

  it("사이드바 포커스 링(sidebar-ring/50)은 사이드바 위에서 3:1 이상이다", () => {
    const ring = over(tokens["sidebar-ring"], solid("sidebar"), 0.5);
    expect(contrast(ring, solid("sidebar"))).toBeGreaterThanOrEqual(3);
  });

  it.each(["background", "card", "popover"])(
    "입력 테두리(input)는 %s 위에서 3:1 이상이다",
    (bg) => {
      const border = over(tokens.input, solid(bg));
      expect(contrast(border, solid(bg))).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("크기·모션 접근성 규칙", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "index.css"), "utf-8");

  it("글자 크기 토큰은 12px(0.75rem) 이상이다", () => {
    const sizes = [...css.matchAll(/--text-[\w-]+?:\s*([\d.]+)rem;/g)].map(
      ([, rem]) => Number(rem),
    );
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(0.75);
  });

  it("터치 화면에서 누르는 영역을 44px(2.75rem) 이상으로 넓힌다", () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*?min-block-size: 2\.75rem;\s*min-inline-size: 2\.75rem;/,
    );
  });

  it("모션 줄이기와 고대비 모드를 처리한다", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?:focus-visible/,
    );
  });
});
