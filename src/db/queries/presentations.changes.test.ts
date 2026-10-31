import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol, driveTombstonesCol, presentationsCol } from "../collections";
import { createTestDb, deckDoc, seedDocs, userDoc } from "../test/fixtures";
import {
  DEFAULT_DECK_STYLE,
  MAX_CLOCK_SKEW_MS,
  PresentationDocumentSchema,
  toPresentationChanges,
  type Deck,
  type PresentationChangesRequest,
  type PresentationDocument,
} from "#shared";
import {
  deletePresentation,
  getPresentationDocumentsByUserId,
  savePresentationChanges,
  upsertPresentationDocument,
  type SavePresentationResult,
} from "./presentations";

const USER_A = "000000000000000000001";
const USER_B = "000000000000000000002";
const DOC_ID = "100000000000000000001";

function deckId(n: number): string {
  return `c${String(n).padStart(20, "0")}`;
}

function itemId(n: number): string {
  return `3${String(n).padStart(20, "0")}`;
}

function makeSet(userId: string, songCount: number): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: Array.from({ length: songCount }, (_, n) => ({
      id: itemId(n),
      presentationId: DOC_ID,
      deckId: deckId(n),
      order: n,
      deck: {
        id: deckId(n),
        userId,
        scope: "presentation",
        presentationId: DOC_ID,
        title: `곡 ${n}`,
        artist: "",
        lyricsRaw: `가사 ${n}`,
        slides: [{ id: `s${n}`, order: 0, lines: [`가사 ${n}`] }],
        backgroundId: null,
        style: DEFAULT_DECK_STYLE,
        forkedFrom: null,
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      },
    })),
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function withLyrics(
  doc: PresentationDocument,
  index: number,
  lyricsRaw: string,
): PresentationDocument {
  return {
    ...doc,
    updatedAt: "2026-09-22T00:00:00.000Z",
    items: doc.items.map((item, i) =>
      i === index ? { ...item, deck: { ...item.deck, lyricsRaw } } : item,
    ),
  };
}

describe("세트 변경분 저장", () => {
  let db: Db;

  async function readSet(userId = USER_A): Promise<PresentationDocument> {
    const [doc] = await getPresentationDocumentsByUserId(db, userId);
    return doc;
  }

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: USER_A, name: "A" }),
        userDoc({ id: USER_B, name: "B" }),
      ],
    });
    await upsertPresentationDocument(db, USER_A, makeSet(USER_A, 10));
  });

  it("바뀐 덱만 보내도 나머지 곡은 그대로 남는다", async () => {
    const edited = withLyrics(makeSet(USER_A, 10), 3, "고친 가사");
    const changes = toPresentationChanges(
      edited,
      (deck) => deck.id === deckId(3),
    );

    expect(await savePresentationChanges(db, USER_A, changes)).toMatchObject({
      status: "saved",
    });

    const restored = await readSet();
    expect(restored.items).toHaveLength(10);
    expect(restored.items[3].deck.lyricsRaw).toBe("고친 가사");
    expect(restored.items[4].deck.lyricsRaw).toBe("가사 4");
    expect(restored.updatedAt).toBe("2026-09-22T00:00:00.000Z");
  });

  it("목록에서 빠진 곡은 덱까지 지운다 (되살아나지 않는다)", async () => {
    const doc = makeSet(USER_A, 10);
    const removed = { ...doc, items: doc.items.filter((_, i) => i !== 5) };

    expect(
      await savePresentationChanges(
        db,
        USER_A,
        toPresentationChanges(removed, () => false),
      ),
    ).toMatchObject({ status: "saved" });

    const restored = await readSet();
    expect(restored.items.map((item) => item.deck.id)).not.toContain(deckId(5));
    expect(restored.items.map((item) => item.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect((await decksCol(db).doc(deckId(5)).get()).exists).toBe(false);
  });

  it("덱 없이 순서만 보내도 곡 순서가 바뀐다", async () => {
    const doc = makeSet(USER_A, 3);
    await upsertPresentationDocument(db, USER_A, doc);
    const reordered = {
      ...doc,
      items: [doc.items[2], doc.items[0], doc.items[1]].map((item, order) => ({
        ...item,
        order,
      })),
    };

    await savePresentationChanges(
      db,
      USER_A,
      toPresentationChanges(reordered, () => false),
    );

    const restored = await readSet();
    expect(restored.items.map((item) => item.deck.id)).toEqual([
      deckId(2),
      deckId(0),
      deckId(1),
    ]);
  });

  it("새 곡은 덱을 담아 보내면 추가된다", async () => {
    const doc = makeSet(USER_A, 11);

    await savePresentationChanges(
      db,
      USER_A,
      toPresentationChanges(doc, (deck) => deck.id === deckId(10)),
    );

    const restored = await readSet();
    expect(restored.items).toHaveLength(11);
    expect(restored.items[10].deck.title).toBe("곡 10");
  });

  it("서버에 없는 덱을 빼고 보내면 stale로 거절하고 아무것도 쓰지 않는다", async () => {
    const doc = withLyrics(makeSet(USER_A, 11), 0, "고친 가사");

    expect(
      await savePresentationChanges(
        db,
        USER_A,
        toPresentationChanges(doc, (deck) => deck.id === deckId(0)),
      ),
    ).toEqual({ status: "stale" });

    const restored = await readSet();
    expect(restored.items).toHaveLength(10);
    expect(restored.items[0].deck.lyricsRaw).toBe("가사 0");
  });

  it("처음 저장하는 세트에서 덱이 빠지면 stale이다", async () => {
    const other = { ...makeSet(USER_B, 1), id: "100000000000000000002" };

    expect(
      await savePresentationChanges(
        db,
        USER_B,
        toPresentationChanges(other, () => false),
      ),
    ).toEqual({ status: "stale" });
  });

  it("남의 세트는 변경분으로도 덮어쓰지 못한다", async () => {
    const doc = withLyrics(makeSet(USER_B, 10), 0, "탈취");

    expect(
      await savePresentationChanges(
        db,
        USER_B,
        toPresentationChanges(doc, (deck) => deck.id === deckId(0)),
      ),
    ).toEqual({ status: "forbidden" });
    expect((await readSet()).items[0].deck.lyricsRaw).toBe("가사 0");
  });

  it("본문의 userId가 세션 사용자와 다르면 내 세트도 쓰지 않는다", async () => {
    const edited = withLyrics(makeSet(USER_A, 10), 0, "다른 계정의 대기열");

    expect(
      await savePresentationChanges(db, USER_A, {
        ...toPresentationChanges(edited),
        userId: USER_B,
      }),
    ).toEqual({ status: "forbidden" });

    const restored = await readSet();
    expect(restored.items).toHaveLength(10);
    expect(restored.items[0].deck.lyricsRaw).toBe("가사 0");
    expect(restored.updatedAt).toBe("2026-09-21T00:00:00.000Z");
    expect(await getPresentationDocumentsByUserId(db, USER_B)).toHaveLength(0);
  });

  it("다른 세트의 덱 id를 보내면 그 덱을 건드리지 않고 거절한다", async () => {
    const other = {
      ...withLyrics(makeSet(USER_A, 1), 0, "가로채기"),
      id: "100000000000000000002",
    };

    expect(
      await savePresentationChanges(db, USER_A, toPresentationChanges(other)),
    ).toEqual({ status: "forbidden" });
    expect((await readSet()).items[0].deck.lyricsRaw).toBe("가사 0");
  });

  it("공유받은 세트(access)는 저장하지 않는다", async () => {
    const shared = { ...makeSet(USER_A, 10), access: { ownerName: "A" } };

    expect(
      await savePresentationChanges(db, USER_A, toPresentationChanges(shared)),
    ).toEqual({ status: "forbidden" });
  });

  it("영구 삭제 기록을 지운다", async () => {
    await driveTombstonesCol(db)
      .doc(DOC_ID)
      .set({ itemId: DOC_ID, userId: USER_A, kind: "presentation" });

    await savePresentationChanges(
      db,
      USER_A,
      toPresentationChanges(makeSet(USER_A, 10), () => false),
    );

    expect((await driveTombstonesCol(db).doc(DOC_ID).get()).exists).toBe(false);
  });

  it("남의 영구 삭제 기록은 지우지 않는다", async () => {
    const other = "100000000000000000009";
    await driveTombstonesCol(db)
      .doc(other)
      .set({ itemId: other, userId: USER_B, kind: "presentation" });

    expect(
      await savePresentationChanges(
        db,
        USER_A,
        toPresentationChanges({ ...makeSet(USER_A, 0), id: other }),
      ),
    ).toMatchObject({ status: "saved" });

    expect((await driveTombstonesCol(db).doc(other).get()).exists).toBe(true);
  });

  it("바뀌지 않은 사본은 다시 쓰지 않는다 (자리·내용 유지)", async () => {
    const copies = async () =>
      (await decksCol(db).where("presentationId", "==", DOC_ID).get()).docs
        .map((doc) => ({ ...doc.data(), writtenAt: doc.updateTime.toMillis() }))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const before = await copies();

    await savePresentationChanges(
      db,
      USER_A,
      toPresentationChanges(
        withLyrics(makeSet(USER_A, 10), 0, "고친 가사"),
        (deck) => deck.id === deckId(0),
      ),
    );

    const after = await copies();
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(after[0]).toMatchObject({
      itemId: before[0].itemId,
      position: 0,
      lyricsRaw: "고친 가사",
    });
  });

  it("남아 있는 두 곡이 항목 id를 맞바꿔도 저장된다", async () => {
    const doc = makeSet(USER_A, 10);
    const swapped = {
      ...doc,
      items: doc.items.map((item, i) =>
        i === 0
          ? { ...item, id: itemId(1) }
          : i === 1
            ? { ...item, id: itemId(0) }
            : item,
      ),
    };

    expect(
      await savePresentationChanges(
        db,
        USER_A,
        toPresentationChanges(swapped, () => false),
      ),
    ).toMatchObject({ status: "saved" });

    const restored = await readSet();
    expect(
      restored.items.slice(0, 2).map((item) => [item.id, item.deckId]),
    ).toEqual([
      [itemId(1), deckId(0)],
      [itemId(0), deckId(1)],
    ]);
  });

  it("forkedFrom은 내 곡을 가리킬 때만 남긴다 (남의 곡 id 존재 여부를 흘리지 않는다)", async () => {
    await seedDocs(db, {
      decks: [
        deckDoc({ id: "library-song", userId: USER_A }),
        deckDoc({ id: "others-song", userId: USER_B }),
      ],
    });
    const doc = makeSet(USER_A, 13);
    doc.items[10].deck.forkedFrom = "library-song";
    doc.items[11].deck.forkedFrom = "c0000000000000000dead";
    doc.items[12].deck.forkedFrom = "others-song";

    expect(
      await savePresentationChanges(
        db,
        USER_A,
        toPresentationChanges(doc, (deck) =>
          [deckId(10), deckId(11), deckId(12)].includes(deck.id),
        ),
      ),
    ).toMatchObject({ status: "saved" });

    const restored = await readSet();
    expect(restored.items[10].deck.forkedFrom).toBe("library-song");
    expect(restored.items[11].deck.forkedFrom).toBeNull();
    expect(restored.items[12].deck.forkedFrom).toBeNull();
  });
});

describe("기준 판으로 거르는 저장과 늘 커지는 판", () => {
  const T1 = "2026-09-21T00:00:00.000Z";
  const T2 = "2026-09-22T00:00:00.000Z";
  const T3 = "2026-09-23T00:00:00.000Z";
  const T4 = "2026-09-24T00:00:00.000Z";
  const NOW = new Date("2026-09-25T00:00:00.000Z");
  let db: Db;

  function plus(iso: string, ms: number): string {
    return new Date(Date.parse(iso) + ms).toISOString();
  }

  function version(
    songCount: number,
    updatedAt: string,
    overrides: Partial<PresentationDocument> = {},
  ): PresentationDocument {
    return { ...makeSet(USER_A, songCount), updatedAt, ...overrides };
  }

  function changesOf(
    doc: PresentationDocument,
    baseUpdatedAt: string | null,
    includeDeck: (deck: Deck) => boolean = () => true,
  ): PresentationChangesRequest {
    return { ...toPresentationChanges(doc, includeDeck), baseUpdatedAt };
  }

  function save(
    changes: PresentationChangesRequest,
    userId = USER_A,
  ): Promise<SavePresentationResult> {
    return savePresentationChanges(db, userId, changes, NOW);
  }

  async function readSet(): Promise<PresentationDocument | undefined> {
    const [doc] = await getPresentationDocumentsByUserId(db, USER_A);
    return doc;
  }

  async function copyIds(): Promise<string[]> {
    const snapshot = await decksCol(db)
      .where("presentationId", "==", DOC_ID)
      .get();
    return snapshot.docs.map((doc) => doc.id).sort();
  }

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: USER_A, name: "A" }),
        userDoc({ id: USER_B, name: "B" }),
      ],
    });
  });

  it("낡은 기준으로 보낸 저장은 쓰지 않고 저장된 판을 돌려준다 (다른 기기가 넣은 곡이 남는다)", async () => {
    expect(await save(changesOf(version(3, T1), null))).toEqual({
      status: "saved",
      updatedAt: new Date(T1),
    });
    expect(
      await save(
        changesOf(version(4, T3), T1, (deck) => deck.id === deckId(3)),
      ),
    ).toEqual({ status: "saved", updatedAt: new Date(T3) });

    const stale = await save(changesOf(version(3, T4), T1, () => false));

    const stored = await readSet();
    expect(stale).toEqual({ status: "conflict", current: stored });
    expect(stored?.items).toHaveLength(4);
    expect(stored?.updatedAt).toBe(T3);
    expect((await decksCol(db).doc(deckId(3)).get()).exists).toBe(true);
  });

  it("기준이 저장된 판과 같으면 쓰고 보낸 시각을 판으로 남긴다", async () => {
    await save(changesOf(version(3, T1), null));
    const edited = withLyrics(version(3, T1), 1, "고친 가사");

    expect(
      await save(changesOf(edited, T1, (deck) => deck.id === deckId(1))),
    ).toEqual({ status: "saved", updatedAt: new Date(T2) });

    const stored = await readSet();
    expect(stored?.updatedAt).toBe(T2);
    expect(stored?.items[1].deck.lyricsRaw).toBe("고친 가사");
  });

  it("보낸 시각이 저장된 판보다 이르거나 같으면 저장된 판 + 1ms로 남긴다", async () => {
    await save(changesOf(version(3, T2), null));

    expect(
      await save(changesOf(version(3, T2, { title: "같은 시각" }), T2)),
    ).toEqual({ status: "saved", updatedAt: new Date(plus(T2, 1)) });
    expect(
      await save(
        changesOf(version(3, T1, { title: "이른 시각" }), plus(T2, 1)),
      ),
    ).toEqual({ status: "saved", updatedAt: new Date(plus(T2, 2)) });

    expect(await readSet()).toMatchObject({
      title: "이른 시각",
      updatedAt: plus(T2, 2),
    });
  });

  it("서버 시계 + 5분보다 늦은 시각은 줄여서 남긴다", async () => {
    const limit = new Date(NOW.getTime() + MAX_CLOCK_SKEW_MS);

    expect(
      await save(changesOf(version(3, "9999-12-31T00:00:00.000Z"), null)),
    ).toEqual({ status: "saved", updatedAt: limit });
    expect((await readSet())?.updatedAt).toBe(limit.toISOString());
  });

  it("판이 Firestore가 담는 마지막 시각에 박혀 있어도 다음 판이 1970년으로 돌아가지 않는다", async () => {
    const last = "9999-12-31T23:59:59.999Z";
    await save(changesOf(version(3, T1), null));
    await presentationsCol(db)
      .doc(DOC_ID)
      .update({ updatedAt: new Date(last) });

    expect(
      await save(toPresentationChanges(version(3, T2, { title: "고친 제목" }))),
    ).toEqual({ status: "saved", updatedAt: new Date(last) });
    expect(
      await save(
        changesOf(version(3, T3, { title: "기준을 실은 저장" }), last),
      ),
    ).toEqual({ status: "saved", updatedAt: new Date(last) });

    expect(await readSet()).toMatchObject({
      title: "기준을 실은 저장",
      updatedAt: last,
    });
  });

  it("충돌로 돌려주는 판은 곡을 문서 id 순서가 아니라 저장된 순서대로 담는다", async () => {
    await save(changesOf(version(3, T1), null));
    const doc = version(3, T2);
    const reversed = {
      ...doc,
      items: [...doc.items]
        .reverse()
        .map((item, order) => ({ ...item, order })),
    };
    expect(await save(changesOf(reversed, T1, () => false))).toMatchObject({
      status: "saved",
    });

    const stale = await save(
      changesOf(version(3, T3, { title: "낡은 기기의 제목" }), T1, () => false),
    );

    const stored = await readSet();
    expect(stored?.items.map((item) => item.deck.id)).toEqual([
      deckId(2),
      deckId(1),
      deckId(0),
    ]);
    expect(stale).toEqual({ status: "conflict", current: stored });
  });

  it("서버에 있는 세트를 기준 null로 보내면 충돌이다", async () => {
    await save(changesOf(version(3, T1), null));

    const result = await save(
      changesOf(version(3, T2, { title: "다른 기기의 새 세트" }), null),
    );

    expect(result).toEqual({ status: "conflict", current: await readSet() });
    expect((await readSet())?.title).toBe("주일 1부 예배");
  });

  it("기준이 낡으면 서버에 없는 덱을 빼고 보내도 stale이 아니라 충돌이다 (지운 곡을 다시 보내지 않는다)", async () => {
    await save(changesOf(version(3, T1), null));
    await save(changesOf(version(2, T2), T1, () => false));

    const result = await save(changesOf(version(3, T3), T1, () => false));

    expect(result).toMatchObject({ status: "conflict" });
    expect(await copyIds()).toEqual([deckId(0), deckId(1)]);
  });

  it("남의 세트에는 기준을 실어 보내도 충돌이 아니라 forbidden이다", async () => {
    await save(changesOf(version(3, T1), null));
    const theirs = { ...makeSet(USER_B, 3), updatedAt: T2 };

    for (const base of [T1, null, "2026-09-01T00:00:00.000Z"]) {
      expect(await save(changesOf(theirs, base), USER_B)).toEqual({
        status: "forbidden",
      });
    }
    expect((await readSet())?.updatedAt).toBe(T1);
  });

  it("서버에 없고 영구 삭제 기록도 없는 세트는 기준과 상관없이 만든다", async () => {
    expect(await save(changesOf(version(3, T2), T1))).toEqual({
      status: "saved",
      updatedAt: new Date(T2),
    });
    expect((await readSet())?.items).toHaveLength(3);
  });

  it("기준 없이 보낸 옛 시각의 저장(되돌리기)도 받고 판은 앞 판 + 1ms로 남긴다", async () => {
    await save(toPresentationChanges(version(3, T1)));
    await save(toPresentationChanges(version(2, T2), () => false));

    const undo = await save(toPresentationChanges(version(3, T1)));

    expect(undo).toEqual({ status: "saved", updatedAt: new Date(plus(T2, 1)) });
    const stored = await readSet();
    expect(stored?.items).toHaveLength(3);
    expect(stored?.updatedAt).toBe(plus(T2, 1));
  });

  it("영구 삭제한 프레젠테이션은 기준이 있든 없든 다시 만들지 않고 영구 삭제 기록을 남긴다", async () => {
    await save(changesOf(version(3, T1), null));
    await save(changesOf(version(3, T2, { trashedAt: T2 }), T1));
    expect(await deletePresentation(db, DOC_ID, USER_A)).toEqual({
      status: "deleted",
    });

    for (const changes of [
      toPresentationChanges(version(3, T3)),
      toPresentationChanges(version(3, T3), () => false),
      changesOf(version(3, T3), null),
      changesOf(version(3, T3), T2),
    ]) {
      expect(await save(changes)).toEqual({ status: "deleted" });
    }
    expect(await upsertPresentationDocument(db, USER_A, version(3, T3))).toBe(
      false,
    );

    expect((await presentationsCol(db).doc(DOC_ID).get()).exists).toBe(false);
    expect(await copyIds()).toEqual([]);
    expect((await driveTombstonesCol(db).doc(DOC_ID).get()).data()).toEqual({
      itemId: DOC_ID,
      userId: USER_A,
      kind: "presentation",
    });
  });
});
