import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { backgrounds } from "../schema";
import { initialBackgrounds, seedBackgrounds } from "./backgrounds";

describe("Task 4.5: 초기 10개 모션 루프 영상 D1 시드", () => {
  let testDb: TestDbResult;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  it("initialBackgrounds defines exactly 10 valid motion video presets covering required tags", () => {
    expect(initialBackgrounds).toHaveLength(10);

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validMoods = new Set(["잔잔한", "밝은", "웅장한"]);
    const validColors = new Set(["따뜻한", "차가운", "어두운"]);

    for (const bg of initialBackgrounds) {
      expect(bg.id).toMatch(uuidRegex);
      expect(bg.title).toBeTruthy();
      expect(bg.r2Key).toMatch(/^loops\/.+\.mp4$/);
      expect(bg.posterKey).toMatch(/^posters\/.+\.webp$/);
      expect(bg.durationSec).toBeGreaterThan(0);
      expect(bg.license).toBeTruthy();

      const tags = JSON.parse(bg.tags) as string[];
      expect(tags.some((t) => validMoods.has(t))).toBe(true);
      expect(tags.some((t) => validColors.has(t))).toBe(true);
    }
  });

  it("seedBackgrounds inserts 10 records idempotently", async () => {
    // 1st run
    const count1 = await seedBackgrounds(testDb.db);
    expect(count1).toBe(10);

    const rows1 = await testDb.db.select().from(backgrounds);
    expect(rows1).toHaveLength(10);

    // 2nd run (idempotent)
    const count2 = await seedBackgrounds(testDb.db);
    expect(count2).toBe(10);

    const rows2 = await testDb.db.select().from(backgrounds);
    expect(rows2).toHaveLength(10);
  });
});
