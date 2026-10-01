import { describe, it, expect } from "vitest";
import { makeBackground } from "../../test/backgroundFixture";
import {
  filterBackgrounds,
  filterBackgroundsByKind,
  matchesBackgroundQuery,
} from "./backgroundSearch";

const CLOUDS = makeBackground(1, {
  title: "푸른 하늘 구름",
  description:
    "흰 구름이 천천히 흘러가요. 가운데가 비어 있어 가사가 잘 보여요.",
  keywords: ["파란색", "하늘", "구름", "잔잔한", "묵상", "clouds"],
});
const TREE = makeBackground(2, {
  title: "반짝이는 트리",
  description: "금빛 조명이 달린 트리가 반짝여요.",
  keywords: ["금색", "트리", "성탄", "크리스마스", "christmas"],
});

const search = (query: string): string[] =>
  [CLOUDS, TREE]
    .filter((bg) => matchesBackgroundQuery(bg, query))
    .map((bg) => bg.title);

describe("matchesBackgroundQuery", () => {
  it("빈 검색어는 모두 통과한다", () => {
    expect(search("  ")).toEqual(["푸른 하늘 구름", "반짝이는 트리"]);
  });

  it("제목에 없는 말도 키워드로 찾는다", () => {
    expect(search("성탄")).toEqual(["반짝이는 트리"]);
    expect(search("묵상")).toEqual(["푸른 하늘 구름"]);
  });

  it("키워드의 앞부분과 초성, 영어로도 찾는다", () => {
    expect(search("파란")).toEqual(["푸른 하늘 구름"]);
    expect(search("ㅋㄹㅅㅁㅅ")).toEqual(["반짝이는 트리"]);
    expect(search("Christmas")).toEqual(["반짝이는 트리"]);
  });

  it("여러 단어는 모두 맞아야 한다", () => {
    expect(search("파란 구름")).toEqual(["푸른 하늘 구름"]);
    expect(search("파란 트리")).toEqual([]);
  });

  it("설명 문장은 글자 그대로 들어 있을 때만 맞고 초성으로는 맞지 않는다", () => {
    expect(search("흘러가요")).toEqual(["푸른 하늘 구름"]);
    expect(search("ㄱㅅㄱ")).toEqual([]);
  });

  it("검색 메타데이터가 없는 배경은 제목으로만 찾는다", () => {
    const legacy = makeBackground(3, { title: "고요한 호수" });
    expect(matchesBackgroundQuery(legacy, "ㅎㅅ")).toBe(true);
    expect(matchesBackgroundQuery(legacy, "구름")).toBe(false);
  });
});

describe("filterBackgrounds", () => {
  const STILL = makeBackground(4, {
    title: "고요한 성탄 이미지",
    kind: "image",
    keywords: ["성탄"],
  });
  const all = [CLOUDS, TREE, STILL];
  const titles = (kind: "all" | "video" | "image", query: string): string[] =>
    filterBackgrounds(all, { kind, query }).map((bg) => bg.title);

  it("종류만 고르면 그 종류만 남기고, all이면 원래 배열을 그대로 준다", () => {
    expect(filterBackgroundsByKind(all, "all")).toBe(all);
    expect(titles("image", "")).toEqual(["고요한 성탄 이미지"]);
    expect(titles("video", "")).toEqual(["푸른 하늘 구름", "반짝이는 트리"]);
  });

  it("종류와 검색어가 모두 맞아야 남는다", () => {
    expect(titles("all", "성탄")).toEqual([
      "반짝이는 트리",
      "고요한 성탄 이미지",
    ]);
    expect(titles("video", "성탄")).toEqual(["반짝이는 트리"]);
    expect(titles("image", "구름")).toEqual([]);
  });
});
