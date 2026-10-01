import { describe, it, expect } from "vitest";
import type { Presentation } from "#shared";
import { mergeDocuments, planBootMerge } from "./mergeDocuments";

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

  describe("공유받은 세트", () => {
    const access = { ownerName: "인도자", memberId: USER };

    it("서버 목록에서 빠지면 지우고 올리지 않는다", () => {
      const { documents, needsPush, removed } = mergeDocuments(
        [doc("a", "2026-09-22T10:00:00.000Z", { access })],
        [],
      );

      expect(documents).toEqual([]);
      expect(needsPush).toEqual([]);
      expect(removed).toEqual(["a"]);
    });

    it("로컬이 더 새로워 보여도 서버본을 쓴다", () => {
      const { documents, needsPush } = mergeDocuments(
        [doc("a", "2026-09-22T12:00:00.000Z", { access, title: "로컬" })],
        [doc("a", "2026-09-22T10:00:00.000Z", { access, title: "원본" })],
      );

      expect(documents[0].title).toBe("원본");
      expect(needsPush).toEqual([]);
    });
  });
});

describe("부팅 병합 계획", () => {
  const access = { ownerName: "인도자", memberId: USER };
  const at = "2026-09-22T10:00:00.000Z";

  it("서버 삭제 기록에 있는 로컬 문서는 병합에서 빼고 지운다", () => {
    const plan = planBootMerge(
      [doc("a", "2026-09-22T12:00:00.000Z"), doc("b", at)],
      [doc("b", at)],
      ["a"],
      new Set(["a", "b"]),
    );

    expect(plan.documents.map((d) => d.id)).toEqual(["b"]);
    expect(plan.needsPush).toEqual([]);
    expect(plan.removedIds).toEqual(["a"]);
  });

  it("로컬에 없는 문서의 삭제 기록은 지울 대상에 넣지 않는다", () => {
    const plan = planBootMerge([], [], ["gone"], new Set());

    expect(plan.removedIds).toEqual([]);
  });

  it("받기 전부터 알던 공유 세트가 서버 목록에서 빠지면 지운다", () => {
    const plan = planBootMerge(
      [doc("shared", at, { access })],
      [],
      [],
      new Set(["shared"]),
    );

    expect(plan.documents).toEqual([]);
    expect(plan.removedIds).toEqual(["shared"]);
  });

  it("받는 사이에 들어온 공유 세트는 서버 목록에 없어도 남긴다", () => {
    const joined = doc("joined", at, { access });
    const plan = planBootMerge([joined], [], [], new Set());

    expect(plan.documents).toEqual([joined]);
    expect(plan.removedIds).toEqual([]);
    expect(plan.needsPush).toEqual([]);
  });

  it("삭제 기록을 먼저, 빠진 공유 세트를 그다음에 지운다", () => {
    const plan = planBootMerge(
      [doc("shared", at, { access }), doc("deleted", at)],
      [],
      ["deleted"],
      new Set(["shared", "deleted"]),
    );

    expect(plan.removedIds).toEqual(["deleted", "shared"]);
  });

  it("로컬에만 있는 문서는 push 대상이 된다", () => {
    const plan = planBootMerge(
      [doc("local", at)],
      [doc("server", at)],
      [],
      new Set(["local"]),
    );

    expect(plan.documents.map((d) => d.id).sort()).toEqual(["local", "server"]);
    expect(plan.needsPush).toEqual(["local"]);
  });
});
