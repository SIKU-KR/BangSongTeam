import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Query, type WriteBatch } from "@google-cloud/firestore";
import { betterAuth } from "better-auth/minimal";
import { runBulk, type Db } from "../client";
import { COLLECTIONS } from "../collections";
import { clearDb, createTestDb, seedDocs, userDoc } from "../test/fixtures";
import { firestoreAdapter, matchesWhere } from "./firestoreAdapter";

type Clause = Parameters<typeof matchesWhere>[1][number];

const MINUTE_MS = 60_000;

function clause(
  field: string,
  operator: string,
  value: unknown,
  extra: Partial<Clause> = {},
): Clause {
  return { field, operator, value, connector: "AND", ...extra };
}

const db = createTestDb();

async function authContext(database: Db = db) {
  return await betterAuth({
    database: firestoreAdapter(database),
    secret: "adapter-test-secret-0123456789-abcdefghijklmnop",
    baseURL: "http://localhost:5173",
    telemetry: { enabled: false },
  }).$context;
}

function recordWhereCalls(): unknown[][] {
  const calls: unknown[][] = [];
  const original = Query.prototype.where;
  vi.spyOn(Query.prototype, "where").mockImplementation(function (
    this: Query,
    ...args: unknown[]
  ) {
    calls.push(args);
    return (original as (...a: unknown[]) => Query).apply(this, args);
  });
  return calls;
}

function capBatchWrites(database: Db, maxWrites: number): Db {
  const capped = (batch: WriteBatch): WriteBatch => {
    let writes = 0;
    return new Proxy(batch, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== "function") return value;
        if (prop === "commit") {
          return () =>
            writes > maxWrites
              ? Promise.reject(new Error("request payload size exceeds limit"))
              : (value as () => Promise<unknown>).call(target);
        }
        return (...args: unknown[]) => {
          if (["create", "set", "update", "delete"].includes(String(prop))) {
            writes += 1;
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  };
  return new Proxy(database, {
    get(target, prop) {
      if (prop === "batch") return () => capped(target.batch());
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

async function seedVerifications(
  count: number,
  expiresAt: Date,
  prefix: string,
): Promise<void> {
  const createdAt = new Date(expiresAt.getTime() - 10 * MINUTE_MS);
  await runBulk(db, (writer) =>
    Array.from({ length: count }, (_, i) => {
      const id = `${prefix}-${String(i).padStart(5, "0")}`;
      return writer.set(db.collection(COLLECTIONS.verifications).doc(id), {
        id,
        identifier: `${prefix}-state-${i}`,
        value: "{}",
        expiresAt,
        createdAt,
        updatedAt: createdAt,
      });
    }),
  );
}

async function countDocs(collection: string): Promise<number> {
  return (await db.collection(collection).count().get()).data().count;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("matchesWhere", () => {
  it("연결어를 왼쪽부터 차례로 적용한다", () => {
    const where = [
      clause("a", "eq", 1),
      clause("b", "eq", 2, { connector: "OR" }),
      clause("c", "eq", 3),
    ];

    expect(matchesWhere({ a: 1, b: 0, c: 3 }, where)).toBe(true);
    expect(matchesWhere({ a: 0, b: 2, c: 3 }, where)).toBe(true);
    expect(matchesWhere({ a: 1, b: 2, c: 0 }, where)).toBe(false);
  });

  it("null과 같음은 값이 null인 필드와 아예 없는 필드를 모두 찾는다", () => {
    const where = [clause("image", "eq", null)];

    expect(matchesWhere({ image: null }, where)).toBe(true);
    expect(matchesWhere({}, where)).toBe(true);
    expect(matchesWhere({ image: "a.png" }, where)).toBe(false);
  });

  it("대소문자를 가리지 않는 같음·in을 지원한다", () => {
    const row = { email: "Team@Example.com" };

    expect(
      matchesWhere(row, [
        clause("email", "eq", "team@EXAMPLE.com", { mode: "insensitive" }),
      ]),
    ).toBe(true);
    expect(
      matchesWhere(row, [
        clause("email", "in", ["x@y.z", "TEAM@example.COM"], {
          mode: "insensitive",
        }),
      ]),
    ).toBe(true);
    expect(matchesWhere(row, [clause("email", "eq", "team@example.com")])).toBe(
      false,
    );
  });

  it("in·not_in은 값 목록으로 가른다", () => {
    expect(matchesWhere({ n: 2 }, [clause("n", "in", [1, 2])])).toBe(true);
    expect(matchesWhere({ n: 3 }, [clause("n", "in", [1, 2])])).toBe(false);
    expect(matchesWhere({ n: 3 }, [clause("n", "not_in", [1, 2])])).toBe(true);
  });

  it("범위 비교는 비교할 값이나 필드가 비어 있으면 맞지 않는다", () => {
    const now = new Date();

    expect(matchesWhere({ at: now }, [clause("at", "lt", null)])).toBe(false);
    expect(matchesWhere({}, [clause("at", "lt", now)])).toBe(false);
    expect(matchesWhere({ at: null }, [clause("at", "lte", now)])).toBe(false);
    expect(
      matchesWhere({ at: new Date(now.getTime() - 1) }, [
        clause("at", "lt", now),
      ]),
    ).toBe(true);
  });
});

describe("Firestore 인증 어댑터 (에뮬레이터)", () => {
  beforeEach(async () => {
    await clearDb(db);
  });

  describe("OAuth state(verifications)", () => {
    it("같은 식별자로 두 번 저장하면 새 값을 찾고, 지울 때는 둘 다 지운다", async () => {
      const ctx = await authContext();
      const expiresAt = new Date(Date.now() + 10 * MINUTE_MS);
      await ctx.internalAdapter.createVerificationValue({
        identifier: "state-1",
        value: "old",
        expiresAt,
        createdAt: new Date(Date.now() - MINUTE_MS),
      });
      await ctx.internalAdapter.createVerificationValue({
        identifier: "state-1",
        value: "new",
        expiresAt,
      });

      expect(
        (await ctx.internalAdapter.findVerificationValue("state-1"))?.value,
      ).toBe("new");

      await ctx.internalAdapter.deleteVerificationByIdentifier("state-1");
      expect(await countDocs(COLLECTIONS.verifications)).toBe(0);
    });

    it("한 번 쓰는 값을 동시에 꺼내도 한 요청만 받는다", async () => {
      const [first, second] = await Promise.all([authContext(), authContext()]);
      await first.internalAdapter.createVerificationValue({
        identifier: "once",
        value: "token",
        expiresAt: new Date(Date.now() + 10 * MINUTE_MS),
      });

      const results = await Promise.all([
        first.internalAdapter.consumeVerificationValue("once"),
        second.internalAdapter.consumeVerificationValue("once"),
      ]);

      expect(results.filter((row) => row !== null)).toHaveLength(1);
      expect(await countDocs(COLLECTIONS.verifications)).toBe(0);
    });

    it("같은 값을 두 번 예약하면 먼저 예약한 요청만 성공한다", async () => {
      const ctx = await authContext();
      const reserve = () =>
        ctx.internalAdapter.reserveVerificationValue({
          identifier: "jti-1",
          value: "used",
          expiresAt: new Date(Date.now() + 10 * MINUTE_MS),
        });

      expect(await reserve()).toBe(true);
      expect(await reserve()).toBe(false);
    });
  });

  describe("조건을 Firestore 쿼리로 넘기는 규칙", () => {
    it("null·OR·대소문자 무시 조건은 넘기지 않고, 범위 조건은 혼자일 때만 넘긴다", async () => {
      const ctx = await authContext();
      const calls = recordWhereCalls();
      const now = new Date();

      await ctx.adapter.findMany({
        model: "user",
        where: [{ field: "image", value: null }],
      });
      await ctx.adapter.findMany({
        model: "user",
        where: [
          { field: "email", value: "a@example.com" },
          { field: "email", value: "b@example.com", connector: "OR" },
        ],
      });
      await ctx.adapter.findMany({
        model: "user",
        where: [{ field: "email", value: "A@x.com", mode: "insensitive" }],
      });
      await ctx.adapter.findMany({
        model: "session",
        where: [
          { field: "userId", value: "u1" },
          { field: "expiresAt", value: now, operator: "gt" },
        ],
      });
      expect(calls).toEqual([["userId", "==", "u1"]]);

      await ctx.adapter.findMany({
        model: "verification",
        where: [{ field: "expiresAt", value: now, operator: "lt" }],
      });
      expect(calls.at(-1)).toEqual(["expiresAt", "<", now]);
    });

    it("값이 30개를 넘는 in 조건도 모두 찾는다", async () => {
      const ids = Array.from(
        { length: 31 },
        (_, i) => `user${String(i).padStart(16, "0")}`,
      );
      await seedDocs(db, { users: ids.map((id) => userDoc({ id })) });
      const ctx = await authContext();

      const found = await ctx.adapter.findMany<{ id: string }>({
        model: "user",
        where: [{ field: "id", value: ids, operator: "in" }],
        limit: 100,
      });

      expect(found.map((user) => user.id).sort()).toEqual(ids);
    });

    it("정렬·건너뛰기·개수 제한을 차례로 적용한다", async () => {
      const ctx = await authContext();
      const base = Date.now();
      for (const [index, token] of ["a", "b", "c", "d"].entries()) {
        await ctx.adapter.create({
          model: "session",
          data: {
            userId: "owner",
            token,
            expiresAt: new Date(base + MINUTE_MS),
            createdAt: new Date(base - (4 - index) * MINUTE_MS),
            updatedAt: new Date(base),
          },
        });
      }

      const page = await ctx.adapter.findMany<{ token: string }>({
        model: "session",
        where: [{ field: "userId", value: "owner" }],
        sortBy: { field: "createdAt", direction: "desc" },
        offset: 1,
        limit: 2,
      });

      expect(page.map((session) => session.token)).toEqual(["c", "b"]);
    });

    it("image 필드가 아예 없는 사용자 문서도 image가 null인 조건에 맞는다", async () => {
      const { image, ...withoutImage } = userDoc({
        id: "noimage0000000000001",
        email: "noimage@example.com",
      });
      void image;
      await db
        .collection(COLLECTIONS.users)
        .doc(withoutImage.id)
        .set(withoutImage);
      const ctx = await authContext();

      const found = await ctx.adapter.findOne<{ id: string }>({
        model: "user",
        where: [
          { field: "email", value: "noimage@example.com" },
          { field: "image", value: null },
        ],
      });

      expect(found?.id).toBe(withoutImage.id);
    });
  });

  describe("여러 문서 지우기", () => {
    it("쌓인 만료 state가 많아도 한 번의 커밋에 몰아 지우지 않는다", async () => {
      await seedVerifications(1_200, new Date(Date.now() - MINUTE_MS), "old");
      await seedVerifications(3, new Date(Date.now() + 10 * MINUTE_MS), "live");
      const ctx = await authContext(capBatchWrites(db, 500));

      const deleted = await ctx.adapter.deleteMany({
        model: "verification",
        where: [{ field: "expiresAt", value: new Date(), operator: "lt" }],
      });

      expect(deleted).toBe(1_200);
      expect(await countDocs(COLLECTIONS.verifications)).toBe(3);
    });
  });
});
