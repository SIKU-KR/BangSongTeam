import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";
import { clientSourceFiles } from "./test/clientSources";

const CLIENT_DIR = __dirname;

describe("화면 높이 단위", () => {
  it("화면을 채우는 높이는 툴바 밑까지 잡히는 h-screen·100vh 대신 동적 뷰포트 단위(dvh)를 쓴다", () => {
    const offenders = clientSourceFiles()
      .filter((file) =>
        /\bh-screen\b|\b100vh\b/.test(fs.readFileSync(file, "utf-8")),
      )
      .map((file) => path.relative(CLIENT_DIR, file));

    expect(offenders).toEqual([]);
  });

  it("h-dvh·min-h-dvh는 100dvh로 풀린다 (Chrome 111·Safari 16.4 이상이 지원한다)", async () => {
    const compiler = await compile("@tailwind utilities;");

    const css = compiler.build(["h-dvh", "min-h-dvh"]);

    expect(css).toMatch(/\.h-dvh \{\s*height: 100dvh/);
    expect(css).toMatch(/\.min-h-dvh \{\s*min-height: 100dvh/);
  });
});
