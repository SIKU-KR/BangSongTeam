import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import { user, decks, presentationItems, driveTombstones } from "../schema";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  toPresentationChanges,
  type PresentationDocument,
} from "#shared";
import {
  getPresentationDocumentsByUserId,
  savePresentationChanges,
  upsertPresentationDocument,
} from "./presentations";
import { tombstoneStatements } from "./folders";
import { runStatements } from "./batch";

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
        visibility: "private",
        forkedFrom: null,
        forkCount: 0,
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
  let db: ReturnType<typeof createTestDb>["db"];

  async function readSet(userId = USER_A): Promise<PresentationDocument> {
    const [doc] = await getPresentationDocumentsByUserId(db, userId);
    return doc;
  }

  beforeEach(async () => {
    db = createTestDb().db;
    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    await upsertPresentationDocument(db, USER_A, makeSet(USER_A, 10));
  });

  it("바뀐 덱만 보내도 나머지 곡은 그대로 남는다", async () => {
    const edited = withLyrics(makeSet(USER_A, 10), 3, "고친 가사");
    const changes = toPresentationChanges(
      edited,
      (deck) => deck.id === deckId(3),
    );

    expect(await savePresentationChanges(db, USER_A, changes)).toBe("saved");

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
    ).toBe("saved");

    const restored = await readSet();
    expect(restored.items.map((item) => item.deck.id)).not.toContain(deckId(5));
    expect(restored.items.map((item) => item.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const orphan = await db
      .select()
      .from(decks)
      .where(eq(decks.id, deckId(5)));
    expect(orphan).toHaveLength(0);
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
    ).toBe("stale");

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
    ).toBe("stale");
  });

  it("남의 세트는 변경분으로도 덮어쓰지 못한다", async () => {
    const doc = withLyrics(makeSet(USER_B, 10), 0, "탈취");

    expect(
      await savePresentationChanges(
        db,
        USER_B,
        toPresentationChanges(doc, (deck) => deck.id === deckId(0)),
      ),
    ).toBe("forbidden");
    expect((await readSet()).items[0].deck.lyricsRaw).toBe("가사 0");
  });

  it("다른 세트의 덱 id를 보내면 그 덱을 건드리지 않고 거절한다", async () => {
    const other = {
      ...withLyrics(makeSet(USER_A, 1), 0, "가로채기"),
      id: "100000000000000000002",
    };

    expect(
      await savePresentationChanges(db, USER_A, toPresentationChanges(other)),
    ).toBe("forbidden");
    expect((await readSet()).items[0].deck.lyricsRaw).toBe("가사 0");
  });

  it("공유받은 세트(access)는 저장하지 않는다", async () => {
    const shared = { ...makeSet(USER_A, 10), access: { ownerName: "A" } };

    expect(
      await savePresentationChanges(db, USER_A, toPresentationChanges(shared)),
    ).toBe("forbidden");
  });

  it("영구 삭제 기록을 지운다", async () => {
    await runStatements(
      db,
      tombstoneStatements(db, USER_A, "presentation", [DOC_ID]),
    );

    await savePresentationChanges(
      db,
      USER_A,
      toPresentationChanges(makeSet(USER_A, 10), () => false),
    );

    const rows = await db
      .select()
      .from(driveTombstones)
      .where(eq(driveTombstones.itemId, DOC_ID));
    expect(rows).toHaveLength(0);
  });

  it("바뀌지 않은 항목은 다시 쓰지 않는다 (항목 행 id 유지)", async () => {
    const before = await db
      .select()
      .from(presentationItems)
      .where(eq(presentationItems.presentationId, DOC_ID));

    await savePresentationChanges(
      db,
      USER_A,
      toPresentationChanges(
        withLyrics(makeSet(USER_A, 10), 0, "고친 가사"),
        (deck) => deck.id === deckId(0),
      ),
    );

    const after = await db
      .select()
      .from(presentationItems)
      .where(eq(presentationItems.presentationId, DOC_ID));
    expect(after).toEqual(before);
  });
});
