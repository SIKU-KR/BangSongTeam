import { describe, it, expect } from "vitest";
import { makeBackground } from "../../test/backgroundFixture";
import { filterBackgrounds } from "./backgroundSearch";

const CLOUDS = makeBackground(1, { title: "푸른 하늘 구름" });
const TREE = makeBackground(2, { title: "반짝이는 트리" });
const STILL = makeBackground(3, { title: "고요한 성탄 이미지", kind: "image" });
const all = [CLOUDS, TREE, STILL];

const titles = (
  kind: "all" | "video" | "image",
  resultIds?: readonly string[],
): string[] =>
  filterBackgrounds(all, { kind, resultIds }).map((bg) => bg.title);

describe("filterBackgrounds", () => {
  it("검색 결과가 없으면 종류만 거르고, all이면 모두 남긴다", () => {
    expect(titles("all")).toEqual([
      "푸른 하늘 구름",
      "반짝이는 트리",
      "고요한 성탄 이미지",
    ]);
    expect(titles("image")).toEqual(["고요한 성탄 이미지"]);
    expect(titles("video")).toEqual(["푸른 하늘 구름", "반짝이는 트리"]);
  });

  it("검색 결과는 서버가 준 순서(가까운 순)대로 보여 준다", () => {
    expect(titles("all", [STILL.id, CLOUDS.id])).toEqual([
      "고요한 성탄 이미지",
      "푸른 하늘 구름",
    ]);
  });

  it("검색 결과에도 종류 필터를 적용한다", () => {
    expect(titles("video", [STILL.id, TREE.id])).toEqual(["반짝이는 트리"]);
    expect(titles("image", [TREE.id])).toEqual([]);
  });

  it("카탈로그에 없는 id(인덱스에만 남은 지운 배경)는 버린다", () => {
    expect(titles("all", ["x".repeat(21), TREE.id])).toEqual(["반짝이는 트리"]);
  });
});
