import { describe, it, expect } from "vitest";
import type { Folder } from "@repo/shared";
import { mergeFolders } from "./mergeFolders";

const USER = "000000000000000000001";
const A = "a00000000000000000001";
const B = "b00000000000000000002";
const C = "c00000000000000000003";

function folder(id: string, overrides: Partial<Folder> = {}): Folder {
  return {
    id,
    userId: USER,
    parentId: null,
    name: id.slice(0, 1),
    trashedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeFolders", () => {
  it("서버에 없는 로컬 폴더는 살리고 올린다", () => {
    const result = mergeFolders([folder(A)], []);
    expect(result.folders).toEqual([folder(A)]);
    expect(result.needsPush).toEqual([A]);
  });

  it("로컬에 없는 서버 폴더는 받는다", () => {
    const result = mergeFolders([], [folder(A)]);
    expect(result.folders).toEqual([folder(A)]);
    expect(result.needsPush).toEqual([]);
  });

  it("폴더 단위로 더 최신인 쪽을 고른다", () => {
    const localNewer = folder(A, {
      name: "로컬",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    const serverNewer = folder(B, {
      name: "서버",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    const result = mergeFolders(
      [localNewer, folder(B, { name: "옛 로컬" })],
      [folder(A, { name: "옛 서버" }), serverNewer],
    );
    expect(result.folders.find((f) => f.id === A)?.name).toBe("로컬");
    expect(result.folders.find((f) => f.id === B)?.name).toBe("서버");
    expect(result.needsPush).toEqual([A]);
  });

  it("같은 시각이면 서버 것을 쓴다 (서버 보정본이 이긴다)", () => {
    const result = mergeFolders(
      [folder(A, { parentId: B })],
      [folder(A, { parentId: null }), folder(B)],
    );
    expect(result.folders.find((f) => f.id === A)?.parentId).toBeNull();
    expect(result.needsPush).toEqual([]);
  });

  it("합치면 사이클이 되는 로컬 이동은 서버본으로 되돌린다", () => {
    // 서버: B가 A 안에 있다. 이 기기(오프라인)에서는 A를 B 안으로 옮겼다.
    const server = [folder(A), folder(B, { parentId: A })];
    const local = [
      folder(A, { parentId: B, updatedAt: "2026-09-23T00:00:00.000Z" }),
      folder(B, { parentId: A }),
      folder(C, { parentId: A, updatedAt: "2026-09-23T00:00:00.000Z" }),
    ];

    const result = mergeFolders(local, server);
    expect(result.folders.find((f) => f.id === A)?.parentId).toBeNull();
    expect(result.folders.find((f) => f.id === C)?.parentId).toBe(A);
    expect(result.needsPush).toEqual([C]);
  });

  it("생성 순으로 정렬한다", () => {
    const early = folder(B, { createdAt: "2026-09-01T00:00:00.000Z" });
    const late = folder(A, { createdAt: "2026-09-10T00:00:00.000Z" });
    expect(mergeFolders([late], [early]).folders.map((f) => f.id)).toEqual([
      B,
      A,
    ]);
  });
});
