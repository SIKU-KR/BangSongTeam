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
