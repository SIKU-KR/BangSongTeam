import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { lyricsCatalog } from "../schema";
import { nullifyUnknownCatalogs } from "./catalogRefs";

const KNOWN = "d0000000-0000-4000-8000-000000000001";
const UNKNOWN = "d0000000-0000-4000-8000-00000000dead";

describe("nullifyUnknownCatalogs", () => {
  let testDb: TestDbResult;

  beforeEach(async () => {
    testDb = createTestDb();
    await testDb.db.insert(lyricsCatalog).values({
      id: KNOWN,
      title: "시선",
      artist: "",
      titleNorm: "시선",
      artistNorm: "",
      lyricsCanonical: "첫 줄",
    });
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  it("keeps known catalog ids and nulls unknown ones", async () => {
    const rows = await nullifyUnknownCatalogs(testDb.db, [
      { id: "a", catalogId: KNOWN },
      { id: "b", catalogId: UNKNOWN },
      { id: "c", catalogId: null },
      { id: "d" },
    ]);
    expect(rows.map((r) => r.catalogId)).toEqual([
      KNOWN,
      null,
      null,
      undefined,
    ]);
  });

  it("does not query when no row references a catalog", async () => {
    const input = [{ id: "a", catalogId: null }];
    expect(await nullifyUnknownCatalogs(testDb.db, input)).toBe(input);
  });
});
