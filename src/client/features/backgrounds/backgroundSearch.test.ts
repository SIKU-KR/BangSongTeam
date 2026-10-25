import { describe, it, expect } from "vitest";
import { makeBackground } from "../../test/backgroundFixture";
import { filterBackgrounds } from "./backgroundSearch";

const CLOUDS = makeBackground(1, {
  title: "푸른 하늘 구름",
  description: "구름이 천천히 흘러가요.",
  keywords: ["하늘", "Sky"],
});
const TREE = makeBackground(2, { title: "반짝이는 트리" });
const STILL = makeBackground(3, { title: "고요한 성탄 이미지", kind: "image" });
const all = [CLOUDS, TREE, STILL];

const titles = (kind: "all" | "video" | "image", query?: string): string[] =>
  filterBackgrounds(all, { kind, query }).map((bg) => bg.title);

describe("filterBackgrounds", () => {
  it("검색어가 없으면 종류만 거르고, all이면 모두 남긴다", () => {
    expect(titles("all")).toEqual([
      "푸른 하늘 구름",
      "반짝이는 트리",
      "고요한 성탄 이미지",
    ]);
    expect(titles("image")).toEqual(["고요한 성탄 이미지"]);
    expect(titles("video")).toEqual(["푸른 하늘 구름", "반짝이는 트리"]);
  });

  it("제목·설명·키워드에서 낱말을 모두 찾고, 대소문자는 가리지 않는다", () => {
    expect(titles("all", "트리")).toEqual(["반짝이는 트리"]);
    expect(titles("all", "천천히")).toEqual(["푸른 하늘 구름"]);
    expect(titles("all", "sky")).toEqual(["푸른 하늘 구름"]);
    expect(titles("all", "  구름   하늘 ")).toEqual(["푸른 하늘 구름"]);
    expect(titles("all", "구름 트리")).toEqual([]);
  });

  it("검색 결과에도 종류 필터를 적용한다", () => {
    expect(titles("image", "성탄")).toEqual(["고요한 성탄 이미지"]);
    expect(titles("video", "성탄")).toEqual([]);
  });
});
