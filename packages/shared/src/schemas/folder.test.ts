import { describe, it, expect } from "vitest";
import { FolderSchema, FolderDeleteResponseSchema } from "./folder";
import { PresentationSchema } from "./presentation";

const FOLDER = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  userId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
  parentId: null,
  name: "2026 주일 대예배",
  trashedAt: null,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

describe("FolderSchema", () => {
  it("루트 폴더와 하위 폴더를 받는다", () => {
    expect(FolderSchema.parse(FOLDER)).toEqual(FOLDER);
    const child = {
      ...FOLDER,
      id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      parentId: FOLDER.id,
    };
    expect(FolderSchema.parse(child).parentId).toBe(FOLDER.id);
  });

  it("이름 앞뒤 공백을 지우고, 빈 이름·100자 초과는 거절한다", () => {
    expect(FolderSchema.parse({ ...FOLDER, name: "  청년부  " }).name).toBe(
      "청년부",
    );
    expect(FolderSchema.safeParse({ ...FOLDER, name: "   " }).success).toBe(
      false,
    );
    expect(
      FolderSchema.safeParse({ ...FOLDER, name: "가".repeat(101) }).success,
    ).toBe(false);
  });

  it("parentId와 trashedAt은 생략할 수 없다 (null로 명시)", () => {
    const withoutParent: Record<string, unknown> = { ...FOLDER };
    delete withoutParent.parentId;
    expect(FolderSchema.safeParse(withoutParent).success).toBe(false);
  });

  it("영구 삭제 응답", () => {
    const parsed = FolderDeleteResponseSchema.parse({
      ok: true,
      deletedFolderIds: [FOLDER.id],
      deletedPresentationIds: [],
    });
    expect(parsed.deletedFolderIds).toEqual([FOLDER.id]);
  });
});

describe("PresentationSchema 드라이브 필드", () => {
  const base = {
    id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
    userId: FOLDER.userId,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };

  it("폴더 기능 이전 저장본(필드 없음)도 통과하고 필드를 만들어 내지 않는다", () => {
    const parsed = PresentationSchema.parse(base);
    expect("folderId" in parsed).toBe(false);
    expect("trashedAt" in parsed).toBe(false);
  });

  it("folderId·trashedAt을 받는다", () => {
    const parsed = PresentationSchema.parse({
      ...base,
      folderId: FOLDER.id,
      trashedAt: "2026-09-24T00:00:00.000Z",
    });
    expect(parsed.folderId).toBe(FOLDER.id);
    expect(parsed.trashedAt).toBe("2026-09-24T00:00:00.000Z");
    expect(
      PresentationSchema.safeParse({ ...base, folderId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});
