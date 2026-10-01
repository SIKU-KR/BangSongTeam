import { describe, expect, it } from "vitest";
import {
  clickSelection,
  extendSelection,
  resolveInsertIndex,
  resolvePaneSelection,
  stepMoveTarget,
  type PickedSlides,
  type SlideSelectionState,
} from "./slideSelection";

const IDS = ["a", "b", "c", "d", "e"];
const single = (id: string): SlideSelectionState => ({
  selected: [id],
  anchor: id,
  focus: id,
});
const NONE = { shift: false, mod: false };
const MOD = { shift: false, mod: true };
const SHIFT = { shift: true, mod: false };

describe("clickSelection", () => {
  it("그냥 클릭하면 그 장만 고르고 기준점이 된다", () => {
    expect(
      clickSelection(
        IDS,
        { selected: ["a", "b"], anchor: "a", focus: "b" },
        "d",
        NONE,
      ),
    ).toEqual(single("d"));
  });

  it("Ctrl/⌘ 클릭은 넣거나 빼고, 뺀 장이 현재였으면 남은 마지막 장이 현재가 된다", () => {
    const added = clickSelection(IDS, single("b"), "d", MOD);
    expect(added).toEqual({ selected: ["b", "d"], anchor: "d", focus: "d" });

    const removed = clickSelection(IDS, added, "d", MOD);
    expect(removed).toEqual({ selected: ["b"], anchor: "d", focus: "b" });
  });

  it("Ctrl/⌘ 클릭으로 마지막 한 장은 빠지지 않는다", () => {
    expect(clickSelection(IDS, single("c"), "c", MOD)).toEqual(single("c"));
  });

  it("Shift 클릭은 기준점부터 범위를 고르고 기준점은 그대로다", () => {
    expect(clickSelection(IDS, single("d"), "b", SHIFT)).toEqual({
      selected: ["b", "c", "d"],
      anchor: "d",
      focus: "b",
    });
  });

  it("Ctrl+Shift 클릭은 범위를 기존 선택에 더한다", () => {
    const current = { selected: ["a", "d"], anchor: "d", focus: "d" };
    const next = clickSelection(IDS, current, "e", { shift: true, mod: true });
    expect([...next.selected].sort()).toEqual(["a", "d", "e"]);
  });
});

describe("extendSelection", () => {
  it("Shift+↓·↑는 기준점과 현재 사이를 고르고 곡 끝에서 멈춘다", () => {
    const down = extendSelection(IDS, single("c"), 1);
    expect(down).toEqual({ selected: ["c", "d"], anchor: "c", focus: "d" });

    const back = extendSelection(IDS, extendSelection(IDS, down, -1), -1);
    expect(back).toEqual({ selected: ["b", "c"], anchor: "c", focus: "b" });

    expect(extendSelection(IDS, single("e"), 1).selected).toEqual(["e"]);
  });
});

describe("stepMoveTarget", () => {
  it("한 칸 위·아래, 처음·끝으로 옮길 틈 번호를 구한다", () => {
    expect(stepMoveTarget([2, 3], 5, "up")).toBe(1);
    expect(stepMoveTarget([2, 3], 5, "down")).toBe(5);
    expect(stepMoveTarget([0], 5, "up")).toBe(0);
    expect(stepMoveTarget([4], 5, "down")).toBe(5);
    expect(stepMoveTarget([1, 3], 5, "start")).toBe(0);
    expect(stepMoveTarget([1, 3], 5, "end")).toBe(5);
  });
});

describe("resolvePaneSelection", () => {
  const picked: PickedSlides = {
    itemId: "song",
    ids: ["b", "c"],
    anchorId: "c",
  };
  const base = {
    ids: IDS,
    itemId: "song",
    currentId: "b",
    picked,
    insertion: null,
  };

  it("현재 슬라이드를 품은 이 곡의 묶음이면 그 묶음과 기준점을 쓴다", () => {
    expect(resolvePaneSelection(base)).toEqual({
      activeIds: ["b", "c"],
      anchorId: "c",
      selectedIds: ["b", "c"],
      selectedIndexes: [1, 2],
    });
  });

  it("다른 곡에서 고른 묶음이면 현재 슬라이드 한 장만 고른다", () => {
    expect(resolvePaneSelection({ ...base, itemId: "other" })).toEqual({
      activeIds: ["b"],
      anchorId: "b",
      selectedIds: ["b"],
      selectedIndexes: [1],
    });
  });

  it("현재 슬라이드가 묶음 밖이면 현재 슬라이드 한 장만 고른다", () => {
    expect(resolvePaneSelection({ ...base, currentId: "e" })).toEqual({
      activeIds: ["e"],
      anchorId: "e",
      selectedIds: ["e"],
      selectedIndexes: [4],
    });
  });

  it("기준점이 사라졌으면 현재 슬라이드가 기준점이 되고, 현재 슬라이드도 없으면 빈 문자열이다", () => {
    const missingAnchor = { ...picked, anchorId: "gone" };
    expect(
      resolvePaneSelection({ ...base, picked: missingAnchor }).anchorId,
    ).toBe("b");
    expect(
      resolvePaneSelection({ ...base, currentId: undefined, picked: null }),
    ).toEqual({
      activeIds: [],
      anchorId: "",
      selectedIds: [],
      selectedIndexes: [],
    });
  });

  it("삽입 커서가 있으면 고른 묶음은 남기고 화면 선택만 비운다", () => {
    expect(
      resolvePaneSelection({ ...base, insertion: { songIndex: 0, index: 3 } }),
    ).toEqual({
      activeIds: ["b", "c"],
      anchorId: "c",
      selectedIds: [],
      selectedIndexes: [],
    });
  });
});

describe("resolveInsertIndex", () => {
  it("삽입 커서가 있으면 그 틈, 없으면 선택한 마지막 장 뒤, 선택도 없으면 현재 장 뒤", () => {
    expect(resolveInsertIndex({ songIndex: 0, index: 0 }, [2, 3], 3)).toBe(0);
    expect(resolveInsertIndex(null, [3, 1], 1)).toBe(4);
    expect(resolveInsertIndex(null, [], 2)).toBe(3);
  });
});
