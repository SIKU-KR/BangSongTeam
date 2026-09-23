import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbResult } from "../test-utils";
import { lyricsCatalog, lyricsVersions, user } from "../schema";
import { applyCanonical, getNormalizationInput } from "./normalization";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const CAT = "d0000000-0000-4000-8000-000000000001";

describe("정규화 쿼리 헬퍼", () => {
  let testDb: TestDbResult;
  let db: TestDbResult["db"];

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await db.insert(user).values([
      { id: A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    await db.insert(lyricsCatalog).values({
      id: CAT,
      title: "은혜로다",
      titleNorm: "은혜로다",
      artistNorm: "",
      lyricsCanonical: "A의 가사",
      versionCount: 2,
      updatedAt: new Date("2026-09-23T00:00:00Z"),
    });
    await db.insert(lyricsVersions).values([
      {
        id: "v2",
        catalogId: CAT,
        userId: B,
        deckId: "deck-b",
        lyrics: "B의 가사",
        createdAt: new Date("2026-09-22T00:00:00Z"),
      },
      {
        id: "v1",
        catalogId: CAT,
        userId: A,
        deckId: "deck-a",
        lyrics: "A의 가사",
        createdAt: new Date("2026-09-21T00:00:00Z"),
      },
    ]);
  });

  afterEach(() => testDb.sqlite.close());

  async function readCatalog() {
    const [row] = await db
      .select()
      .from(lyricsCatalog)
      .where(eq(lyricsCatalog.id, CAT));
    return row;
  }

  it("reads the catalog with its root versions in registration order", async () => {
    const input = await getNormalizationInput(db, CAT);
    expect(input?.versions.map((v) => v.lyrics)).toEqual([
      "A의 가사",
      "B의 가사",
    ]);
    expect(input?.revision.versionCount).toBe(2);
    expect(await getNormalizationInput(db, "missing")).toBeNull();
  });

  it("writes the canonical lyrics when the revision is unchanged", async () => {
    const input = await getNormalizationInput(db, CAT);
    const wrote = await applyCanonical(db, CAT, {
      canonical: "정규화된 가사",
      source: "llm",
      expected: input!.revision,
    });
    expect(wrote).toBe(true);
    expect(await readCatalog()).toMatchObject({
      lyricsCanonical: "정규화된 가사",
      status: "normalized",
      canonicalSource: "llm",
    });
    expect((await readCatalog()).normalizedAt).toBeInstanceOf(Date);
  });

  it("does not overwrite when a new version arrived meanwhile", async () => {
    const input = await getNormalizationInput(db, CAT);
    await db
      .update(lyricsCatalog)
      .set({ versionCount: 3, updatedAt: new Date("2026-09-24T00:00:00Z") })
      .where(eq(lyricsCatalog.id, CAT));

    expect(
      await applyCanonical(db, CAT, {
        canonical: "옛 입력으로 만든 가사",
        source: "llm",
        expected: input!.revision,
      }),
    ).toBe(false);
    expect((await readCatalog()).lyricsCanonical).toBe("A의 가사");
  });

  it("a second result for the same revision does not overwrite the first", async () => {
    const input = await getNormalizationInput(db, CAT);
    await applyCanonical(db, CAT, {
      canonical: "먼저 끝난 결과",
      source: "llm",
      expected: input!.revision,
    });
    expect(
      await applyCanonical(db, CAT, {
        canonical: "늦게 끝난 결과",
        source: "popular_root",
        expected: input!.revision,
      }),
    ).toBe(false);
    expect((await readCatalog()).lyricsCanonical).toBe("먼저 끝난 결과");
  });

  it("never writes over an operator-locked catalog", async () => {
    await db
      .update(lyricsCatalog)
      .set({ status: "locked", lyricsCanonical: "운영자 정본" })
      .where(eq(lyricsCatalog.id, CAT));
    const input = await getNormalizationInput(db, CAT);

    expect(
      await applyCanonical(db, CAT, {
        canonical: "자동 정규화",
        source: "llm",
        expected: input!.revision,
      }),
    ).toBe(false);
    expect(await readCatalog()).toMatchObject({
      lyricsCanonical: "운영자 정본",
      status: "locked",
    });
  });
});
