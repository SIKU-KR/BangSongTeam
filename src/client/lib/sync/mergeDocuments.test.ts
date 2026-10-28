import { describe, it, expect } from "vitest";
import type { Presentation } from "#shared";
import {
  mergeDocuments,
  planBootMerge,
  relateVersions,
} from "./mergeDocuments";
import { contentFingerprint } from "./presentationLineage";

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

    expect(documents[0]).toEqual({
      ...localDoc,
      baseUpdatedAt: serverDoc.updatedAt,
    });
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

  it("서버 삭제 기록에 있는 로컬 프레젠테이션은 병합에서 빼고 지운다", () => {
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

  it("로컬에 없는 프레젠테이션의 삭제 기록은 지울 대상에 넣지 않는다", () => {
    const plan = planBootMerge([], [], ["gone"], new Set());

    expect(plan.removedIds).toEqual([]);
  });

  it("받기 전부터 알던 공유받은 프레젠테이션이 서버 목록에서 빠지면 지운다", () => {
    const plan = planBootMerge(
      [doc("shared", at, { access })],
      [],
      [],
      new Set(["shared"]),
    );

    expect(plan.documents).toEqual([]);
    expect(plan.removedIds).toEqual(["shared"]);
  });

  it("받는 사이에 들어온 공유받은 프레젠테이션은 서버 목록에 없어도 남긴다", () => {
    const joined = doc("joined", at, { access });
    const plan = planBootMerge([joined], [], [], new Set());

    expect(plan.documents).toEqual([joined]);
    expect(plan.removedIds).toEqual([]);
    expect(plan.needsPush).toEqual([]);
  });

  it("삭제 기록을 먼저, 빠진 공유받은 프레젠테이션을 그다음에 지운다", () => {
    const plan = planBootMerge(
      [doc("shared", at, { access }), doc("deleted", at)],
      [],
      ["deleted"],
      new Set(["shared", "deleted"]),
    );

    expect(plan.removedIds).toEqual(["deleted", "shared"]);
  });

  it("로컬에만 있는 프레젠테이션은 push 대상이 된다", () => {
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

describe("두 판의 관계 (relateVersions)", () => {
  const T1 = "2026-10-01T00:00:00.000Z";
  const T2 = "2026-10-01T00:00:00.001Z";
  const T3 = "2026-10-01T00:10:00.000Z";
  const never = () => false;

  it("기준 판이 없는 이전 저장본이나, 서버 판보다 늦거나 같은 기준 판이면 견주지 않는다 (skip)", () => {
    const server = doc("a", T2, { title: "서버" });

    expect(relateVersions(doc("a", T3, { title: "로컬" }), server, never)).toBe(
      "skip",
    );
    expect(
      relateVersions(
        doc("a", T3, { title: "로컬", baseUpdatedAt: T2 }),
        server,
        never,
      ),
    ).toBe("skip");
    expect(
      relateVersions(
        doc("a", T3, { title: "로컬", baseUpdatedAt: T3 }),
        server,
        never,
      ),
    ).toBe("skip");
  });

  it("내용이 같으면 시각이 달라도 같은 판이다 (same)", () => {
    expect(
      relateVersions(doc("a", T3, { baseUpdatedAt: T1 }), doc("a", T2), never),
    ).toBe("same");
    expect(
      relateVersions(
        doc("a", T3, { baseUpdatedAt: null }),
        doc("a", T2),
        never,
      ),
    ).toBe("same");
  });

  it("서버 판이 이 탭의 계보에 있으면 이 탭이 앞서 있다 (ahead)", () => {
    const server = doc("a", T2, { title: "이 탭이 올린 판" });
    const known = new Set([contentFingerprint(server)]);

    expect(
      relateVersions(
        doc("a", T3, { title: "그 위에서 고친 판", baseUpdatedAt: T1 }),
        server,
        (fingerprint) => known.has(fingerprint),
      ),
    ).toBe("ahead");
  });

  it("고친 것이 없는 판이 서버보다 뒤처졌으면 서버 판을 받는다 (behind)", () => {
    expect(
      relateVersions(
        doc("a", T1, { baseUpdatedAt: T1 }),
        doc("a", T2, { title: "다른 기기의 판" }),
        never,
      ),
    ).toBe("behind");
  });

  it("양쪽 다 고쳤으면 엇갈린 판이다 (diverged)", () => {
    const server = doc("a", T2, { title: "다른 기기의 판" });

    expect(
      relateVersions(
        doc("a", T3, { title: "이 기기의 판", baseUpdatedAt: T1 }),
        server,
        never,
      ),
    ).toBe("diverged");
    expect(
      relateVersions(
        doc("a", T3, { title: "이 기기의 판", baseUpdatedAt: null }),
        server,
        never,
      ),
    ).toBe("diverged");
  });
});

describe("부팅 병합 계획 — 기준 판", () => {
  const T1 = "2026-10-01T00:00:00.000Z";
  const T2 = "2026-10-01T00:05:00.000Z";
  const T3 = "2026-10-01T00:10:00.000Z";
  const FOLDER = "f00000000000000000001";

  function plan(
    local: Presentation[],
    server: Presentation[],
    deletedIds: string[] = [],
    knownBeforePull: Iterable<string> = local.map((d) => d.id),
  ) {
    return planBootMerge(local, server, deletedIds, new Set(knownBeforePull));
  }

  it("고친 것이 없는 판은 서버 판이 더 새로우면 서버 판을 기준 판과 함께 받는다", () => {
    const local = doc("a", T1, { baseUpdatedAt: T1 });
    const server = doc("a", T2, { title: "다른 기기의 판" });

    const { documents, needsPush } = plan([local], [server]);

    expect(documents).toEqual([{ ...server, baseUpdatedAt: T2 }]);
    expect(needsPush).toEqual([]);
  });

  it("받는 사이 확정된 판은 더 오래된 서버 목록으로 되돌리지 않는다", () => {
    const local = doc("a", T3, {
      title: "받는 동안 올린 판",
      baseUpdatedAt: T3,
    });

    const { documents, needsPush } = plan([local], [doc("a", T1)]);

    expect(documents[0]).toBe(local);
    expect(needsPush).toEqual([]);
  });

  it("서버 판과 시각이 같아도 서버가 고친 내용이면 서버 판을 받는다", () => {
    const local = doc("a", T1, { folderId: FOLDER, baseUpdatedAt: T1 });
    const server = doc("a", T1, { folderId: null });

    const { documents, needsPush } = plan([local], [server]);

    expect(documents).toEqual([{ ...server, baseUpdatedAt: T1 }]);
    expect(needsPush).toEqual([]);
  });

  it("서버 판과 시각·내용이 같으면 로컬 판을 그대로 둔다", () => {
    const local = doc("a", T1, { baseUpdatedAt: T1 });

    const { documents, needsPush } = plan([local], [doc("a", T1)]);

    expect(documents[0]).toBe(local);
    expect(needsPush).toEqual([]);
  });

  it("고친 판이 서버 판과 내용이 같으면 서버 판을 맞춘 판으로 받는다", () => {
    const local = doc("a", T2, { title: "같은 내용", baseUpdatedAt: T1 });
    const server = doc("a", T3, { title: "같은 내용" });

    const { documents, needsPush } = plan([local], [server]);

    expect(documents).toEqual([{ ...server, baseUpdatedAt: T3 }]);
    expect(needsPush).toEqual([]);
  });

  it("시계가 느려 서버 판보다 이른 시각이어도 고친 판은 남기고 기준 판 그대로 올린다", () => {
    const local = doc("a", T2, { title: "이 기기의 편집", baseUpdatedAt: T1 });
    const server = doc("a", T3, { title: "다른 기기의 편집" });

    const { documents, needsPush } = plan([local], [server]);

    expect(documents[0]).toBe(local);
    expect(needsPush).toEqual(["a"]);
  });

  it("고친 판이 서버 판과 같아도 서버 목록이 기준 판보다 오래되면 남기고 올린다", () => {
    const local = doc("a", T3, { title: "같은 내용", baseUpdatedAt: T2 });

    const { documents, needsPush } = plan(
      [local],
      [doc("a", T1, { title: "같은 내용" })],
    );

    expect(documents[0]).toBe(local);
    expect(needsPush).toEqual(["a"]);
  });

  it("기준 판이 없는 이전 저장본은 서버 판과 내용이 같으면 맞춘 판으로 받는다", () => {
    const server = doc("a", T2);

    const { documents, needsPush } = plan([doc("a", T1)], [server]);

    expect(documents).toEqual([{ ...server, baseUpdatedAt: T2 }]);
    expect(needsPush).toEqual([]);
  });

  it("기준 판이 없는 이전 저장본이 더 새로우면 서버 판을 기준 판으로 삼아 올린다", () => {
    const local = doc("a", T3, { title: "로컬 편집" });

    const { documents, needsPush } = plan([local], [doc("a", T2)]);

    expect(documents).toEqual([{ ...local, baseUpdatedAt: T2 }]);
    expect(needsPush).toEqual(["a"]);
  });

  it("서버에 없는 내 세트는 서버가 확정한 판이어도 다시 만들도록 기준 판을 비우고 올린다", () => {
    const clean = doc("a", T1, { baseUpdatedAt: T1 });
    const legacy = doc("b", T1);
    const created = doc("c", T1, { baseUpdatedAt: null });

    const { documents, needsPush } = plan([clean, legacy, created], []);

    expect(documents).toEqual([
      { ...clean, baseUpdatedAt: null },
      { ...legacy, baseUpdatedAt: null },
      created,
    ]);
    expect(documents[2]).toBe(created);
    expect(needsPush).toEqual(["a", "b", "c"]);
  });

  it("영구 삭제 기록이 있는 세트는 올리지 않은 편집이 없으면 지운다", () => {
    const { documents, needsPush, removedIds } = plan(
      [doc("a", T1, { baseUpdatedAt: T1 }), doc("b", T1)],
      [],
      ["a", "b"],
    );

    expect(documents).toEqual([]);
    expect(needsPush).toEqual([]);
    expect(removedIds).toEqual(["a", "b"]);
  });

  it("영구 삭제 기록이 있어도 올리지 않은 편집이 있으면 남기고 올려 서버가 정하게 한다", () => {
    const edited = doc("a", T2, { baseUpdatedAt: T1 });
    const created = doc("b", T1, { baseUpdatedAt: null });

    const { documents, needsPush, removedIds } = plan(
      [edited, created],
      [],
      ["a", "b"],
    );

    expect(documents).toEqual([edited, created]);
    expect(documents[0]).toBe(edited);
    expect(needsPush).toEqual(["a", "b"]);
    expect(removedIds).toEqual([]);
  });

  it("영구 삭제 기록이 있어도 기준 판보다 이른 시각으로 고친 세트는 남기고 올린다", () => {
    const edited = doc("a", T1, {
      title: "시계가 늦은 기기의 편집",
      baseUpdatedAt: T2,
    });

    const { documents, needsPush, removedIds } = plan([edited], [], ["a"]);

    expect(documents).toEqual([edited]);
    expect(needsPush).toEqual(["a"]);
    expect(removedIds).toEqual([]);
  });

  it("받기 전부터 알던 내 세트가 그사이 사라졌으면 서버 목록에 있어도 다시 넣지 않는다", () => {
    const { documents, needsPush } = plan(
      [],
      [doc("a", T1), doc("b", T1)],
      [],
      ["a"],
    );

    expect(documents.map((d) => d.id)).toEqual(["b"]);
    expect(needsPush).toEqual([]);
  });
});

describe("다시 받기 병합 계획 (refresh)", () => {
  const T1 = "2026-10-01T00:00:00.000Z";
  const T2 = "2026-10-01T00:05:00.000Z";
  const T3 = "2026-10-01T00:10:00.000Z";
  const FOLDER = "f00000000000000000001";
  const access = { ownerName: "인도자", memberId: USER };

  function refresh(
    local: Presentation[],
    server: Presentation[],
    options: {
      deletedIds?: string[];
      knownBeforePull?: Iterable<string>;
      queued?: string[];
    } = {},
  ) {
    const queued = new Set(options.queued ?? []);
    return planBootMerge(
      local,
      server,
      options.deletedIds ?? [],
      new Set(options.knownBeforePull ?? local.map((d) => d.id)),
      { mode: "refresh", isQueued: (id) => queued.has(id) },
    );
  }

  it("고친 것이 없는 세트는 서버 판이 더 새로울 때만 받는다", () => {
    const behind = doc("a", T1, { baseUpdatedAt: T1 });
    const normalized = doc("b", T1, { folderId: FOLDER, baseUpdatedAt: T1 });
    const ahead = doc("c", T3, { baseUpdatedAt: T3 });
    const newer = doc("a", T2, { title: "다른 기기의 판" });

    const { documents, needsPush, removedIds } = refresh(
      [behind, normalized, ahead],
      [newer, doc("b", T1, { folderId: null }), doc("c", T2)],
    );

    expect(documents).toEqual([
      { ...newer, baseUpdatedAt: T2 },
      normalized,
      ahead,
    ]);
    expect(documents[1]).toBe(normalized);
    expect(documents[2]).toBe(ahead);
    expect(needsPush).toEqual([]);
    expect(removedIds).toEqual([]);
  });

  it("고친 세트·기준 판이 없는 이전 저장본·올리기를 기다리는 세트는 서버 판이 더 새로워도 그대로 둔다", () => {
    const edited = doc("a", T2, { title: "이 기기의 편집", baseUpdatedAt: T1 });
    const created = doc("b", T1, { baseUpdatedAt: null });
    const legacy = doc("c", T1, { title: "이전 저장본" });
    const queued = doc("d", T1, { baseUpdatedAt: T1 });
    const sameContent = doc("e", T2, { baseUpdatedAt: T1 });

    const { documents, needsPush } = refresh(
      [edited, created, legacy, queued, sameContent],
      [
        doc("a", T3, { title: "다른 기기의 판" }),
        doc("b", T3, { title: "다른 기기의 판" }),
        doc("c", T3, { title: "다른 기기의 판" }),
        doc("d", T3, { title: "다른 기기의 판" }),
        doc("e", T3),
      ],
      { queued: ["d"] },
    );

    expect(documents).toHaveLength(5);
    expect(documents[0]).toBe(edited);
    expect(documents[1]).toBe(created);
    expect(documents[2]).toBe(legacy);
    expect(documents[3]).toBe(queued);
    expect(documents[4]).toBe(sameContent);
    expect(needsPush).toEqual([]);
  });

  it("서버에 없는 내 세트는 기준 판을 비우지 않고 그대로 두며 올리지 않는다", () => {
    const clean = doc("a", T1, { baseUpdatedAt: T1 });
    const legacy = doc("b", T1);
    const created = doc("c", T1, { baseUpdatedAt: null });

    const { documents, needsPush, removedIds } = refresh(
      [clean, legacy, created],
      [],
    );

    expect(documents).toHaveLength(3);
    expect(documents[0]).toBe(clean);
    expect(documents[1]).toBe(legacy);
    expect(documents[2]).toBe(created);
    expect(needsPush).toEqual([]);
    expect(removedIds).toEqual([]);
  });

  it("서버에만 있는 세트는 받되, 받기 전부터 알던 세트가 그사이 사라졌으면 다시 넣지 않는다", () => {
    const { documents, needsPush } = refresh(
      [],
      [doc("gone", T1), doc("new", T2)],
      { knownBeforePull: ["gone"] },
    );

    expect(documents).toEqual([{ ...doc("new", T2), baseUpdatedAt: T2 }]);
    expect(needsPush).toEqual([]);
  });

  it("영구 삭제 기록이 있는 세트는 고친 것이 없고 올리기를 기다리지 않을 때만 지우고, 남긴 세트도 올리지 않는다", () => {
    const clean = doc("a", T1, { baseUpdatedAt: T1 });
    const edited = doc("b", T2, { baseUpdatedAt: T1 });
    const queued = doc("c", T1, { baseUpdatedAt: T1 });
    const legacy = doc("d", T1);

    const { documents, needsPush, removedIds } = refresh(
      [clean, edited, queued, legacy],
      [],
      { deletedIds: ["a", "b", "c", "d"], queued: ["c"] },
    );

    expect(documents).toHaveLength(3);
    expect(documents[0]).toBe(edited);
    expect(documents[1]).toBe(queued);
    expect(documents[2]).toBe(legacy);
    expect(needsPush).toEqual([]);
    expect(removedIds).toEqual(["a"]);
  });

  it("공유받은 세트는 부팅 때처럼 서버본을 쓰고, 받기 전부터 알던 세트가 목록에서 빠지면 지운다", () => {
    const shared = doc("a", T1, { access, title: "옛 원본" });
    const ended = doc("b", T1, { access });
    const joined = doc("c", T1, { access });
    const original = doc("a", T2, { access, title: "원본" });

    const { documents, needsPush, removedIds } = refresh(
      [shared, ended, joined],
      [original],
      { knownBeforePull: ["a", "b"] },
    );

    expect(documents).toEqual([original, joined]);
    expect(needsPush).toEqual([]);
    expect(removedIds).toEqual(["b"]);
  });
});
