import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { backgrounds } from "../schema";
import { getBackgrounds } from "./backgrounds";

describe("backgrounds query helper", () => {
  let testDb: TestDbResult;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  it("returns all background records", async () => {
    const emptyResult = await getBackgrounds(testDb.db);
    expect(emptyResult).toEqual([]);

    await testDb.db.insert(backgrounds).values({
      id: "a00000000000000000001",
      title: "잔잔한 물결",
      r2Key: "loops/gentle-waves.mp4",
      posterKey: "posters/gentle-waves.webp",
      durationSec: 15,
      license: "CC0",
      tags: JSON.stringify(["잔잔한", "차가운"]),
    });

    const result = await getBackgrounds(testDb.db);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("잔잔한 물결");
    expect(result[0].r2Key).toBe("loops/gentle-waves.mp4");
  });
});
