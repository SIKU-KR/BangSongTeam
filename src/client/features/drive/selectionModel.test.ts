import { describe, it, expect } from "vitest";
import {
  marqueeKeys,
  mergeKeys,
  rangeKeys,
  stepFocus,
  toggleKey,
} from "./selectionModel";

const KEYS = ["a", "b", "c", "d", "e"];

describe("toggleKey", () => {
  it("없으면 넣고 있으면 뺀다", () => {
    expect(toggleKey(new Set(["a"]), "b")).toEqual(["a", "b"]);
    expect(toggleKey(new Set(["a", "b"]), "a")).toEqual(["b"]);
  });
});

describe("rangeKeys", () => {
  it("기준점과 대상 사이를 방향과 상관없이 고른다", () => {
    expect(rangeKeys(KEYS, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeKeys(KEYS, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("기준점이 없거나 목록에 없으면 대상만 고른다", () => {
    expect(rangeKeys(KEYS, null, "c")).toEqual(["c"]);
    expect(rangeKeys(KEYS, "zz", "c")).toEqual(["c"]);
  });
});

describe("mergeKeys", () => {
  it("중복 없이 순서를 지켜 합친다", () => {
    expect(mergeKeys(["a", "c"], ["c", "d"])).toEqual(["a", "c", "d"]);
  });
});

describe("stepFocus", () => {
  it("한 칸씩 움직이고 끝에서 멈춘다", () => {
    expect(stepFocus(KEYS, "b", 1)).toBe("c");
    expect(stepFocus(KEYS, "a", -1)).toBe("a");
    expect(stepFocus(KEYS, "e", 1)).toBe("e");
  });

  it("Home·End는 처음·끝으로 간다", () => {
    expect(stepFocus(KEYS, "c", -Infinity)).toBe("a");
    expect(stepFocus(KEYS, "c", Infinity)).toBe("e");
  });

  it("포커스가 없으면 아래는 처음, 위는 끝에서 시작한다", () => {
    expect(stepFocus(KEYS, null, 1)).toBe("a");
    expect(stepFocus(KEYS, null, -1)).toBe("e");
    expect(stepFocus([], null, 1)).toBeNull();
  });
});

describe("marqueeKeys", () => {
  const rows = KEYS.map((key, i) => ({
    key,
    left: 0,
    right: 500,
    top: i * 48,
    bottom: (i + 1) * 48,
  }));

  it("사각형과 겹치는 행만 고른다", () => {
    expect(
      marqueeKeys(rows, { left: 10, right: 40, top: 60, bottom: 150 }),
    ).toEqual(["b", "c", "d"]);
  });

  it("경계에 닿기만 한 행은 빼고, 행 밖이면 아무것도 없다", () => {
    expect(
      marqueeKeys(rows, { left: 10, right: 40, top: 48, bottom: 96 }),
    ).toEqual(["b"]);
    expect(
      marqueeKeys(rows, { left: 600, right: 700, top: 0, bottom: 300 }),
    ).toEqual([]);
  });
});
