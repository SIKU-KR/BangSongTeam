import { describe, it, expect } from "vitest";
import { buildFolderIndex, type Folder, type Presentation } from "@repo/shared";
import {
  buildChildCounts,
  canDropInto,
  formatEditedAgo,
  itemKey,
  listFolderContents,
  listTrash,
  parseItemKey,
  searchDrive,
  withDirectionParticle,
  withObjectParticle,
} from "./driveModel";

const USER = "000000000000000000001";

function folder(
  id: string,
  name: string,
  overrides: Partial<Folder> = {},
): Folder {
  return {
    id,
    userId: USER,
    parentId: null,
    name,
    trashedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function doc(
  id: string,
  title: string,
  overrides: Partial<Presentation> = {},
): Presentation {
  return {
    id,
    userId: USER,
    title,
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

// 루트: [2026(a) ⊃ 주일(b)], 청년부(c, 휴지통), 세트 x(루트), y(a 안), z(b 안), w(휴지통), v(c 안)
const FOLDERS = [
  folder("a", "2026", { updatedAt: "2026-09-22T00:00:00.000Z" }),
  folder("b", "주일", { parentId: "a" }),
  folder("c", "청년부", { trashedAt: "2026-09-23T00:00:00.000Z" }),
];
const DOCS = [
  doc("x", "루트 세트", { updatedAt: "2026-09-24T00:00:00.000Z" }),
  doc("y", "가을 예배", { folderId: "a" }),
  doc("z", "은혜로다 세트", { folderId: "b" }),
  doc("w", "버린 세트", { trashedAt: "2026-09-21T00:00:00.000Z" }),
  doc("v", "청년 세트", { folderId: "c" }),
  doc("orphan", "고아 세트", { folderId: "gone" }),
];
const index = buildFolderIndex(FOLDERS);

describe("listFolderContents", () => {
  it("폴더를 앞에 두고 휴지통 항목은 빼고 보여 준다", () => {
    const items = listFolderContents(index, DOCS, null, "name");
    expect(items.map((i) => i.key)).toEqual([
      "folder:a",
      "file:orphan", // 사라진 폴더를 가리키면 루트에 보인다
      "file:x",
    ]);
  });

  it("폴더 안의 내용만 보여 준다", () => {
    expect(
      listFolderContents(index, DOCS, "a", "name").map((i) => i.key),
    ).toEqual(["folder:b", "file:y"]);
  });

  it("최근 수정순이면 파일끼리 최신이 먼저, 폴더는 여전히 앞", () => {
    const items = listFolderContents(index, DOCS, null, "recent");
    expect(items[0].key).toBe("folder:a");
    expect(items[1].key).toBe("file:x");
  });

  it("폴더 '항목 N개'는 휴지통을 빼고 센다", () => {
    const counts = buildChildCounts(index, DOCS);
    expect(counts.get("a")).toBe(2); // b + y
    expect(counts.get("b")).toBe(1); // z
  });
});

describe("searchDrive", () => {
  it("모든 폴더를 가로질러 찾고 위치를 붙인다", () => {
    const items = searchDrive(index, DOCS, "은혜", "name");
    expect(items.map((i) => i.key)).toEqual(["file:z"]);
    expect(items[0].location).toBe("내 드라이브 › 2026 › 주일");
  });

  it("폴더 이름도 찾는다 (초성 포함)", () => {
    expect(searchDrive(index, DOCS, "ㅈㅇ", "name").map((i) => i.key)).toEqual([
      "folder:b",
    ]);
  });

  it("휴지통에 있거나 휴지통 폴더 안에 있는 항목은 찾지 않는다", () => {
    expect(searchDrive(index, DOCS, "청년", "name")).toEqual([]);
    expect(searchDrive(index, DOCS, "버린", "name")).toEqual([]);
  });
});

describe("listTrash", () => {
  it("직접 버린 항목 중 조상이 휴지통에 없는 것만, 최근에 버린 순", () => {
    const items = listTrash(index, DOCS);
    // v는 휴지통 폴더(c) 안에 있으므로 c와 함께 한 줄로 보인다
    expect(items.map((i) => i.key)).toEqual(["folder:c", "file:w"]);
  });

  it("휴지통 안에서도 검색한다", () => {
    expect(listTrash(index, DOCS, "버린").map((i) => i.key)).toEqual([
      "file:w",
    ]);
  });
});

describe("canDropInto", () => {
  it("파일은 어느 폴더든, 폴더는 자기·하위만 빼고", () => {
    expect(canDropInto(index, [{ kind: "file", id: "x" }], "b")).toBe(true);
    expect(canDropInto(index, [{ kind: "folder", id: "a" }], "b")).toBe(false);
    expect(canDropInto(index, [{ kind: "folder", id: "a" }], "a")).toBe(false);
    expect(canDropInto(index, [{ kind: "folder", id: "b" }], null)).toBe(true);
  });

  it("휴지통 폴더·없는 폴더에는 놓을 수 없다", () => {
    expect(canDropInto(index, [{ kind: "file", id: "x" }], "c")).toBe(false);
    expect(canDropInto(index, [{ kind: "file", id: "x" }], "gone")).toBe(false);
    expect(canDropInto(index, [], null)).toBe(false);
  });
});

describe("표시 도우미", () => {
  it("항목 키를 만들고 푼다", () => {
    expect(parseItemKey(itemKey("folder", "abc"))).toEqual({
      kind: "folder",
      id: "abc",
    });
  });

  it("편집 시각을 사람 말로", () => {
    const now = new Date("2026-09-24T12:00:00.000Z").getTime();
    expect(formatEditedAgo("2026-09-24T08:00:00.000Z", now)).toBe(
      "오늘 편집함",
    );
    expect(formatEditedAgo("2026-09-23T08:00:00.000Z", now)).toBe(
      "어제 편집함",
    );
    expect(formatEditedAgo("2026-09-10T08:00:00.000Z", now)).toBe(
      "2주일 전 편집함",
    );
    expect(formatEditedAgo("not-a-date", now)).toBe("최근 편집됨");
  });

  it("받침에 맞춰 조사를 고른다", () => {
    expect(withObjectParticle("‘주일’")).toBe("‘주일’을");
    expect(withObjectParticle("‘청년부’")).toBe("‘청년부’를");
    expect(withObjectParticle("3개 항목")).toBe("3개 항목을");
    expect(withObjectParticle("‘Youth’")).toBe("‘Youth’을(를)");
    expect(withDirectionParticle("‘주일’")).toBe("‘주일’로");
    expect(withDirectionParticle("‘예배당’")).toBe("‘예배당’으로");
    expect(withDirectionParticle("‘청년부’")).toBe("‘청년부’로");
    expect(withDirectionParticle("‘2026’")).toBe("‘2026’(으)로");
  });
});
