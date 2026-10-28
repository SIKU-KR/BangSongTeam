import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadManifest } from "./importBackgrounds.mjs";

const ITEM = {
  id: "AbCdEfGhIjKlMnOpQrStU",
  file: "loop.mp4",
  title: "은은한 빛의 흐름",
  description: "따뜻한 빛이 천천히 번져요.",
  keywords: ["빛", "따뜻한"],
};

describe("배경 매니페스트 확인 (importBackgrounds.mjs)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function manifestWith(item: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-manifest-"));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ items: [item] }));
    return manifestPath;
  }

  it("영상 파일이 없어도 올바른 매니페스트를 그대로 읽는다", () => {
    expect(loadManifest(manifestWith(ITEM)).items).toEqual([ITEM]);
  });

  it.each([
    ["검색어에 문자열이 아닌 값이 있으면", { keywords: ["빛", 2024] }],
    ["설명이 문자열이 아니면", { description: 7 }],
    ["제목이 문자열이 아니면", { title: 2024 }],
  ])("%s 올리기 전에 멈춘다", (_label, override) => {
    const manifestPath = manifestWith({ ...ITEM, ...override });

    expect(() => loadManifest(manifestPath)).toThrow(ITEM.file);
  });

  it("설명이 없으면 받아들인다", () => {
    const manifestPath = manifestWith({ ...ITEM, description: undefined });

    expect(loadManifest(manifestPath).items).toHaveLength(1);
  });
});
