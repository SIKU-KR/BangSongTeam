import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { user } from "../schema";
import { agreeToTerms, getTermsAgreedAt } from "./consent";

const A = "00000000000000000000a";
const B = "00000000000000000000b";

describe("consent queries", () => {
  let testDb: TestDbResult;
  let db: TestDbResult["db"];

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await db.insert(user).values([
      { id: A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
  });

  afterEach(() => testDb.sqlite.close());

  it("동의 전에는 null이다", async () => {
    expect(await getTermsAgreedAt(db, A)).toBeNull();
  });

  it("해당 사용자에게만 동의 시각을 기록한다", async () => {
    const at = new Date("2026-09-27T01:00:00Z");
    expect(await agreeToTerms(db, A, at)).toEqual(at);
    expect(await getTermsAgreedAt(db, A)).toEqual(at);
    expect(await getTermsAgreedAt(db, B)).toBeNull();
  });

  it("다시 동의해도 처음 동의한 시각을 유지한다", async () => {
    const first = new Date("2026-09-27T01:00:00Z");
    await agreeToTerms(db, A, first);
    expect(await agreeToTerms(db, A, new Date("2026-10-01T00:00:00Z"))).toEqual(
      first,
    );
  });

  it("없는 사용자는 null이다", async () => {
    expect(await agreeToTerms(db, "zzzzzzzzzzzzzzzzzzzzz")).toBeNull();
  });
});
