import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Global Styles & Local Pretendard Webfont Configuration", () => {
  const cssPath = path.resolve(__dirname, "index.css");
  const mainPath = path.resolve(__dirname, "main.tsx");

  it("should have index.css that imports local pretendard without external CDNs", () => {
    expect(fs.existsSync(cssPath)).toBe(true);
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Must import local pretendard package
    expect(cssContent).toMatch(/pretendard/);

    // Must not call external CDNs
    expect(cssContent).not.toMatch(/fonts\.googleapis\.com/);
    expect(cssContent).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(cssContent).not.toMatch(/cdnjs\.cloudflare\.com/);

    // Antialiasing and rendering optimization
    expect(cssContent).toMatch(/-webkit-font-smoothing:\s*antialiased/);
  });

  it("should import index.css in main.tsx", () => {
    const mainContent = fs.readFileSync(mainPath, "utf-8");
    expect(mainContent).toMatch(/import\s+['"].\/index\.css['"]/);
  });
});
