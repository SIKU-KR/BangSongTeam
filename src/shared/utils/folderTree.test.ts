import { describe, it, expect } from "vitest";
import {
  buildFolderIndex,
  collectDescendantFolderIds,
  getFolderPath,
  isFolderTrashed,
  resolveFolderId,
  resolveUniqueName,
  sortFoldersParentFirst,
  wouldCreateCycle,
  type FolderLink,
} from "./folderTree";

function folder(
  id: string,
  parentId: string | null,
  trashedAt: string | null = null,
): FolderLink {
  return { id, parentId, trashedAt };
}

const TREE = [
  folder("c", "b"),
  folder("a", null),
  folder("b", "a"),
  folder("d", "a"),
  folder("e", null),
];

describe("buildFolderIndex", () => {
  it("선언된 부모대로 자식 목록을 만든다", () => {
    const index = buildFolderIndex(TREE);
    expect(index.childrenOf.get(null)?.map((f) => f.id)).toEqual(["a", "e"]);
    expect(index.childrenOf.get("a")?.map((f) => f.id)).toEqual(["b", "d"]);
    expect(index.parentOf.get("c")).toBe("b");
    expect(index.cycleMembers.size).toBe(0);
  });

  it("부모가 사라진 고아 폴더는 루트로 취급한다 (하위는 그대로 따라간다)", () => {
    const index = buildFolderIndex([folder("x", "gone"), folder("y", "x")]);
    expect(index.parentOf.get("x")).toBeNull();
    expect(index.parentOf.get("y")).toBe("x");
    expect(index.childrenOf.get(null)?.map((f) => f.id)).toEqual(["x"]);
  });

  it("사이클은 루트로 끊고, 사이클 밖 하위 폴더는 유지한다", () => {
    const index = buildFolderIndex([
      folder("p", "q"),
      folder("q", "p"),
      folder("child", "p"),
    ]);
    expect(index.parentOf.get("p")).toBeNull();
    expect(index.parentOf.get("q")).toBeNull();
    expect(index.parentOf.get("child")).toBe("p");
    expect([...index.cycleMembers].sort()).toEqual(["p", "q"]);
  });

  it("자기 자신을 부모로 가진 폴더도 루트로 끊는다", () => {
    const index = buildFolderIndex([folder("self", "self")]);
    expect(index.parentOf.get("self")).toBeNull();
    expect(index.cycleMembers.has("self")).toBe(true);
  });
});

describe("getFolderPath", () => {
  it("루트부터 해당 폴더까지의 경로를 돌려준다", () => {
    const index = buildFolderIndex(TREE);
    expect(getFolderPath(index, "c").map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(getFolderPath(index, "e").map((f) => f.id)).toEqual(["e"]);
  });

  it("루트·모르는 id면 빈 경로", () => {
    const index = buildFolderIndex(TREE);
    expect(getFolderPath(index, null)).toEqual([]);
    expect(getFolderPath(index, "nope")).toEqual([]);
  });

  it("사이클이 있어도 끝난다", () => {
    const index = buildFolderIndex([folder("p", "q"), folder("q", "p")]);
    expect(getFolderPath(index, "p").map((f) => f.id)).toEqual(["p"]);
  });
});

describe("collectDescendantFolderIds / wouldCreateCycle", () => {
  const index = buildFolderIndex(TREE);

  it("자신을 포함한 모든 하위 폴더", () => {
    expect([...collectDescendantFolderIds(index, "a")].sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(collectDescendantFolderIds(index, "nope").size).toBe(0);
  });

  it("자기 자신이나 하위로 옮기면 사이클", () => {
    expect(wouldCreateCycle(index, "a", "a")).toBe(true);
    expect(wouldCreateCycle(index, "a", "c")).toBe(true);
    expect(wouldCreateCycle(index, "b", "d")).toBe(false);
    expect(wouldCreateCycle(index, "c", null)).toBe(false);
    expect(wouldCreateCycle(index, "e", "c")).toBe(false);
  });
});

describe("isFolderTrashed / resolveFolderId", () => {
  it("조상 중 하나라도 휴지통이면 함께 휴지통으로 본다", () => {
    const index = buildFolderIndex([
      folder("a", null, "2026-09-24T00:00:00.000Z"),
      folder("b", "a"),
      folder("e", null),
    ]);
    expect(isFolderTrashed(index, "a")).toBe(true);
    expect(isFolderTrashed(index, "b")).toBe(true);
    expect(isFolderTrashed(index, "e")).toBe(false);
    expect(isFolderTrashed(index, null)).toBe(false);
  });

  it("사라진 폴더를 가리키면 루트로 돌린다", () => {
    const index = buildFolderIndex(TREE);
    expect(resolveFolderId(index, "a")).toBe("a");
    expect(resolveFolderId(index, "gone")).toBeNull();
    expect(resolveFolderId(index, undefined)).toBeNull();
  });
});

describe("resolveUniqueName", () => {
  it("겹치지 않으면 그대로 (앞뒤 공백 제거)", () => {
    expect(resolveUniqueName("  새 폴더 ", ["다른 폴더"])).toBe("새 폴더");
  });

  it("겹치면 번호를 붙인다 (대소문자·공백 무시)", () => {
    expect(resolveUniqueName("새 폴더", ["새 폴더"])).toBe("새 폴더 (2)");
    expect(resolveUniqueName("Youth", [" youth "])).toBe("Youth (2)");
    expect(resolveUniqueName("새 폴더", ["새 폴더", "새 폴더 (2)"])).toBe(
      "새 폴더 (3)",
    );
  });

  it("이미 번호가 있으면 다음 번호로 올린다", () => {
    expect(resolveUniqueName("새 폴더 (2)", ["새 폴더 (2)"])).toBe(
      "새 폴더 (3)",
    );
  });

  it("번호를 붙여도 100자를 넘지 않는다", () => {
    const long = "가".repeat(100);
    const result = resolveUniqueName(long, [long]);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith(" (2)")).toBe(true);
  });
});

describe("sortFoldersParentFirst", () => {
  it("부모가 자식보다 먼저 온다", () => {
    const sorted = sortFoldersParentFirst(TREE).map((f) => f.id);
    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"));
  });

  it("일부만 정렬할 때도 전체 트리 기준 깊이를 쓴다", () => {
    const subset = [TREE[0], TREE[2]];
    expect(sortFoldersParentFirst(subset, TREE).map((f) => f.id)).toEqual([
      "b",
      "c",
    ]);
  });
});
