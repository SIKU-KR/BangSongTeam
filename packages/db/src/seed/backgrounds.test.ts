import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ID_PATTERN, INITIAL_BACKGROUNDS } from "@repo/shared";
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

    const validMoods = new Set(["잔잔한", "밝은", "웅장한"]);
    const validColors = new Set(["따뜻한", "차가운", "어두운"]);

    for (const bg of initialBackgrounds) {
      expect(bg.id).toMatch(ID_PATTERN);
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

/**
 * 배경 데이터가 갈라지는 것을 막는 가드.
 *
 * 클라이언트는 `INITIAL_BACKGROUNDS`의 id로 `decks.background_id`를 채우고, D1에는
 * 마이그레이션이 넣은 행만 있다. 둘이 어긋나면 외래키 위반으로 세트 저장이 통째로
 * 실패한다 — 실제로 그렇게 동기화가 500으로 죽고 있었다. 정적 SQL은 상수에서
 * 파생시킬 수 없으므로 여기서 대조한다.
 */
describe("0001_initial 배경 시드와 공용 상수 정합성", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../drizzle/0001_initial.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf-8");

  interface SqlRow {
    id: string;
    title: string;
    r2Key: string;
    posterKey: string;
    durationSec: number;
    tags: string[];
  }

  const rows: SqlRow[] = [
    ...sql.matchAll(
      /\('([^']+)', '([^']+)', '([^']+)', '([^']+)', (\d+), '([^']+)', '([^']+)'\)/g,
    ),
  ].map((m) => ({
    id: m[1],
    title: m[2],
    r2Key: m[3],
    posterKey: m[4],
    durationSec: Number(m[5]),
    tags: JSON.parse(m[7]) as string[],
  }));

  it("마이그레이션이 INITIAL_BACKGROUNDS와 완전히 같은 행을 넣는다", () => {
    expect(rows).toHaveLength(INITIAL_BACKGROUNDS.length);

    for (const expected of INITIAL_BACKGROUNDS) {
      const actual = rows.find((row) => row.id === expected.id);
      expect(actual, `${expected.id}가 마이그레이션에 없다`).toBeDefined();
      expect(actual).toEqual({
        id: expected.id,
        title: expected.title,
        r2Key: expected.r2Key,
        posterKey: expected.posterKey,
        durationSec: expected.durationSec,
        tags: [...expected.tags],
      });
    }
  });

  it("이미 채워진 DB에 다시 적용해도 깨지지 않는다 (INSERT OR IGNORE)", () => {
    expect(sql).toContain("INSERT OR IGNORE INTO backgrounds");
  });

  it("마이그레이션이 저널에 등록되어 있다", () => {
    const journal = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../drizzle/meta/_journal.json"),
        "utf-8",
      ),
    ) as { entries: { idx: number; tag: string }[] };

    expect(journal.entries.map((e) => e.tag)).toContain("0001_initial");
  });
});
