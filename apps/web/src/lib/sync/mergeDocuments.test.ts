import { describe, it, expect } from "vitest";
import type { Presentation } from "@repo/shared";
import { mergeDocuments } from "./mergeDocuments";

const USER = "00000000x000000000001";

function doc(
  id: string,
  updatedAt: string,
  overrides: Partial<Presentation> = {},
): Presentation {
  return {
    id,
    userId: USER,
    title: `세트 ${id}`,
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt,
    ...overrides,
  };
}

describe("문서 단위 LWW 병합", () => {
  it("서버에만 있는 문서를 받아 온다 (다른 PC에서 만든 세트)", () => {
    const { documents, needsPush } = mergeDocuments(
      [],
      [doc("a", "2026-09-22T10:00:00.000Z")],
    );

    expect(documents.map((d) => d.id)).toEqual(["a"]);
    expect(needsPush).toEqual([]);
  });

  it("로컬에만 있는 문서는 유지하고 push 대상이 된다", () => {
    // 아직 안 올라간 문서를 '서버에 없음'으로 보고 지우면 작업이 사라진다.
    const { documents, needsPush } = mergeDocuments(
      [doc("a", "2026-09-22T10:00:00.000Z")],
      [],
    );

    expect(documents.map((d) => d.id)).toEqual(["a"]);
    expect(needsPush).toEqual(["a"]);
  });

  it("로컬이 더 최신이면 로컬을 택하고 push 대상이 된다", () => {
    const { documents, needsPush } = mergeDocuments(
      [doc("a", "2026-09-22T12:00:00.000Z", { title: "로컬 최신" })],
      [doc("a", "2026-09-22T10:00:00.000Z", { title: "서버 구본" })],
    );

    expect(documents[0].title).toBe("로컬 최신");
    expect(needsPush).toEqual(["a"]);
  });

  it("서버가 더 최신이면 서버를 택하고 push하지 않는다", () => {
    const { documents, needsPush } = mergeDocuments(
      [doc("a", "2026-09-22T10:00:00.000Z", { title: "로컬 구본" })],
      [doc("a", "2026-09-22T12:00:00.000Z", { title: "서버 최신" })],
    );

    expect(documents[0].title).toBe("서버 최신");
    expect(needsPush).toEqual([]);
  });

  it("updatedAt이 같으면 서버를 택한다 (불필요한 push 방지)", () => {
    const same = "2026-09-22T10:00:00.000Z";
    const { documents, needsPush } = mergeDocuments(
      [doc("a", same, { title: "로컬" })],
      [doc("a", same, { title: "서버" })],
    );

    expect(documents[0].title).toBe("서버");
    expect(needsPush).toEqual([]);
  });

  it("양쪽 문서를 합치고 생성 순으로 정렬한다", () => {
    const { documents } = mergeDocuments(
      [
        doc("local", "2026-09-22T10:00:00.000Z", {
          createdAt: "2026-09-21T00:00:00.000Z",
        }),
      ],
      [
        doc("server", "2026-09-22T10:00:00.000Z", {
          createdAt: "2026-09-19T00:00:00.000Z",
        }),
      ],
    );

    expect(documents.map((d) => d.id)).toEqual(["server", "local"]);
  });

  it("문서 단위로 고른다 (필드를 섞지 않는다)", () => {
    // 곡 순서는 서버 것, 스타일은 로컬 것이 되면 사용자가 만든 적 없는
    // 세트가 나온다.
    const localDoc = doc("a", "2026-09-22T12:00:00.000Z", {
      title: "로컬 제목",
      serviceDate: "2026-10-04",
    });
    const serverDoc = doc("a", "2026-09-22T10:00:00.000Z", {
      title: "서버 제목",
      serviceDate: "2026-09-27",
    });

    const { documents } = mergeDocuments([localDoc], [serverDoc]);

    expect(documents[0]).toEqual(localDoc);
  });
});
