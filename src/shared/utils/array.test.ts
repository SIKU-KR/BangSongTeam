import { describe, expect, it } from "vitest";
import { cycleItem, onlyItem } from "./array";

describe("onlyItem", () => {
  it("원소가 하나일 때만 그 원소를 돌려준다", () => {
    expect(onlyItem(["a"])).toBe("a");
    expect(onlyItem([])).toBeUndefined();
    expect(onlyItem(["a", "b"])).toBeUndefined();
  });
});

describe("cycleItem", () => {
  it("끝을 넘으면 처음부터 다시 고른다", () => {
    expect(cycleItem(["a", "b"], 0)).toBe("a");
    expect(cycleItem(["a", "b"], 3)).toBe("b");
  });

  it("비어 있으면 undefined", () => {
    expect(cycleItem([], 2)).toBeUndefined();
  });
});
