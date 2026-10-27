import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { durationOf, loadManifest } from "./importBackgrounds.mjs";

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

  function manifestWith(item: Record<string, unknown>): {
    manifestPath: string;
    dir: string;
  } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-manifest-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, ITEM.file), "");
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ items: [item] }));
    return { manifestPath, dir };
  }

  it("올바른 매니페스트를 그대로 읽는다", () => {
    const { manifestPath, dir } = manifestWith(ITEM);

    expect(loadManifest(manifestPath, dir).items).toEqual([ITEM]);
  });

  it.each([
    ["검색어에 문자열이 아닌 값이 있으면", { keywords: ["빛", 2024] }],
    ["설명이 문자열이 아니면", { description: 7 }],
    ["제목이 문자열이 아니면", { title: 2024 }],
  ])("%s 올리기 전에 멈춘다", (_label, override) => {
    const { manifestPath, dir } = manifestWith({ ...ITEM, ...override });

    expect(() => loadManifest(manifestPath, dir)).toThrow(ITEM.file);
  });

  it("설명이 없으면 받아들인다", () => {
    const { manifestPath, dir } = manifestWith({
      ...ITEM,
      description: undefined,
    });

    expect(loadManifest(manifestPath, dir).items).toHaveLength(1);
  });
});

describe("영상 길이 (importBackgrounds.mjs)", () => {
  it("ffprobe가 준 길이를 초 단위 정수로 반올림한다", () => {
    expect(durationOf({ format: { duration: "19.6" } }, "loop.mp4")).toBe(20);
  });

  it.each([{ format: {} }, { format: { duration: "N/A" } }, {}])(
    "길이를 읽지 못하면(%j) 등록을 멈춘다",
    (probed) => {
      expect(() => durationOf(probed, "loop.mp4")).toThrow("loop.mp4");
    },
  );
});
