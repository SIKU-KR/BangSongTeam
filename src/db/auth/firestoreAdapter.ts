import type {
  DocumentData,
  DocumentReference,
  Query,
  QueryDocumentSnapshot,
  Transaction,
} from "@google-cloud/firestore";
import { createAdapterFactory } from "better-auth/adapters";
import { runBulk, type Db } from "../client";
import { COLLECTIONS, fromFirestoreData } from "../collections";
import { createUserWithEmail, reservationsHeldBy } from "./userEmails";

type CleanedWhere = {
  field: string;
  value: unknown;
  operator: string;
  connector: "AND" | "OR";
  mode?: "sensitive" | "insensitive";
};

type Row = Record<string, unknown>;

/** Firestore `in`이 받는 값 수. 이보다 많으면 서버에서 거른다 */
const MAX_IN_VALUES = 30;

const RANGE_OPERATORS: Readonly<Record<string, "<" | "<=" | ">" | ">=">> = {
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

function lower(value: unknown): unknown {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function inRange(
  actual: unknown,
  expected: unknown,
  accepts: (order: number) => boolean,
): boolean {
  return (
    actual != null && expected != null && accepts(compare(actual, expected))
  );
}

function matchesClause(row: Row, clause: CleanedWhere): boolean {
  const insensitive = clause.mode === "insensitive";
  const raw = row[clause.field];
  const actual = insensitive ? lower(raw) : raw;
  const expected = insensitive
    ? Array.isArray(clause.value)
      ? clause.value.map(lower)
      : lower(clause.value)
    : clause.value;
  switch (clause.operator) {
    case "in":
      return (expected as unknown[]).some((v) => compare(actual, v) === 0);
    case "not_in":
      return !(expected as unknown[]).some((v) => compare(actual, v) === 0);
    case "contains":
      return typeof actual === "string" && actual.includes(String(expected));
    case "starts_with":
      return typeof actual === "string" && actual.startsWith(String(expected));
    case "ends_with":
      return typeof actual === "string" && actual.endsWith(String(expected));
    case "ne":
      return compare(actual, expected) !== 0;
    case "gt":
      return inRange(actual, expected, (order) => order > 0);
    case "gte":
      return inRange(actual, expected, (order) => order >= 0);
    case "lt":
      return inRange(actual, expected, (order) => order < 0);
    case "lte":
      return inRange(actual, expected, (order) => order <= 0);
    default:
      return expected === null ? raw == null : compare(actual, expected) === 0;
  }
}

/**
 * `connector`를 왼쪽부터 차례로 적용한다 (Better Auth 메모리 어댑터와 같은 해석). 범위 비교는
 * SQL처럼 비어 있는 값과는 맞지 않는다. Firestore 범위 쿼리도 필드가 없거나 `null`인 문서를
 * 돌려주지 않아, 쿼리로 넘겨도 결과가 같다.
 */
export function matchesWhere(
  row: Row,
  where: readonly CleanedWhere[],
): boolean {
  if (where.length === 0) return true;
  let result = matchesClause(row, where[0] as CleanedWhere);
  for (const clause of where.slice(1)) {
    result =
      clause.connector === "OR"
        ? result || matchesClause(row, clause)
        : result && matchesClause(row, clause);
  }
  return result;
}

function pushDownRange(
  query: Query,
  where: readonly CleanedWhere[],
): Query | null {
  const [only] = where;
  const operator = only ? RANGE_OPERATORS[only.operator] : undefined;
  if (where.length !== 1 || !only || !operator) return null;
  if (only.mode === "insensitive") return null;
  if (!(only.value instanceof Date) && typeof only.value !== "number") {
    return null;
  }
  return query.where(only.field, operator, only.value);
}

/**
 * 조건 중 Firestore에 그대로 넘겨도 결과가 같은 것만 쿼리로 만든다. 모두 AND일 때 대소문자를
 * 가리는 `eq`·`in`만 넘긴다. `null`과 같음은 넘기지 않는다. 값이 `undefined`라 빠진 필드는
 * Firestore의 `== null`에 걸리지 않는다. 범위 조건(`lt`·`lte`·`gt`·`gte`)은 그 조건 하나뿐이고
 * 값이 시각·숫자일 때만 넘긴다(만료된 OAuth state 정리처럼 컬렉션 전체를 읽지 않게). 다른 필드
 * 조건과 함께 넘긴 범위는 복합 색인이 있어야 한다. 이 규칙대로면 단일 필드 색인만으로 돌아가
 * 복합 색인이 필요 없다. 나머지 조건과 정렬은 받아 온 문서에서 `matchesWhere`로 다시 확인한다.
 */
function pushDown(query: Query, where: readonly CleanedWhere[]): Query {
  if (where.some((clause) => clause.connector === "OR")) return query;
  const range = pushDownRange(query, where);
  if (range) return range;
  let next = query;
  for (const clause of where) {
    if (clause.mode === "insensitive") continue;
    if (clause.operator === "eq" && clause.value != null) {
      next = next.where(clause.field, "==", clause.value);
    } else if (
      clause.operator === "in" &&
      Array.isArray(clause.value) &&
      clause.value.length > 0 &&
      clause.value.length <= MAX_IN_VALUES
    ) {
      next = next.where(clause.field, "in", clause.value);
    }
  }
  return next;
}

function idLookup(where: readonly CleanedWhere[]): string | null {
  const [clause] = where;
  return where.length === 1 &&
    clause?.field === "id" &&
    clause.operator === "eq" &&
    clause.mode !== "insensitive" &&
    typeof clause.value === "string"
    ? clause.value
    : null;
}

function toRow(snapshot: QueryDocumentSnapshot<DocumentData>): Row {
  return fromFirestoreData(snapshot.data());
}

/**
 * Better Auth용 Firestore 어댑터. 모델마다 컬렉션 하나(`users`·`sessions`·`accounts`·
 * `verifications`)를 쓰고 문서 id는 레코드 `id`다.
 *
 * 조인은 쓰지 않는다(`experimental.joins`를 켜지 않으면 Better Auth가 따로 읽어 붙인다).
 * 인증 조회는 대부분 id·토큰·이메일 같은 같음 조건이라 쿼리로 넘기고, 나머지 조건·정렬·
 * 페이지는 서버에서 처리한다. 한 번 쓰는 값(OAuth state 등)은 `consumeOne`이 트랜잭션으로
 * 읽고 지워 두 요청이 같은 값을 쓰지 못하게 한다.
 *
 * SQL 어댑터와 같게 맞춘 동작:
 * - `create`는 같은 id의 문서가 있으면 덮지 않고 실패한다. 먼저 쓴 쪽이 이기는 예약
 *   (`reserveVerificationValue`)이 이 실패에 기댄다.
 * - 사용자는 이메일마다 하나다. 사용자 문서는 이메일 예약과 함께 만들고(`createUserWithEmail`)
 *   지울 때 그 사용자의 예약도 지운다. 같은 이메일의 두 번째 사용자는 만들지 않고 실패한다.
 * - `delete`는 조건에 맞는 문서를 모두 지운다. 같은 식별자로 두 번 만든 값도 함께 사라진다.
 * - 여러 문서 지우기는 BulkWriter로 나눠 보낸다. 쌓인 문서가 많아도 커밋 하나가 요청 크기
 *   한도(10 MiB)를 넘지 않는다.
 */
export function firestoreAdapter(
  db: Db,
): ReturnType<typeof createAdapterFactory> {
  async function deleteRows(
    model: string,
    rows: readonly { row: Row; ref: DocumentReference }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const reservations =
      model === COLLECTIONS.users
        ? await reservationsHeldBy(
            db,
            rows.map(({ row }) => row),
          )
        : [];
    const refs = [...rows.map(({ ref }) => ref), ...reservations];
    await runBulk(db, (writer) => refs.map((ref) => writer.delete(ref)));
  }

  async function findRows(
    model: string,
    where: readonly CleanedWhere[],
    tx?: Transaction,
  ): Promise<{ row: Row; ref: DocumentReference }[]> {
    const collection = db.collection(model);
    const id = idLookup(where);
    if (id !== null) {
      const ref = collection.doc(id);
      const snapshot = await (tx ? tx.get(ref) : ref.get());
      const data = snapshot.data();
      return data ? [{ row: fromFirestoreData(data), ref }] : [];
    }
    const query = pushDown(collection, where);
    const snapshot = await (tx ? tx.get(query) : query.get());
    return snapshot.docs
      .map((doc) => ({ row: toRow(doc), ref: doc.ref }))
      .filter(({ row }) => matchesWhere(row, where));
  }

  return createAdapterFactory({
    config: {
      adapterId: "firestore",
      adapterName: "Firestore Adapter",
      usePlural: true,
      supportsNumericIds: false,
      supportsJSON: false,
      supportsDates: true,
      supportsBooleans: true,
      supportsArrays: true,
      transaction: false,
    },
    adapter: () => ({
      async create({ model, data }) {
        const row = data as Row;
        const ref = db.collection(model).doc(String(row.id));
        if (model === COLLECTIONS.users && typeof row.email === "string") {
          await createUserWithEmail(db, ref, row.email, row as DocumentData);
        } else {
          await ref.create(row as DocumentData);
        }
        return data;
      },
      async findOne({ model, where }) {
        const [first] = await findRows(model, where as CleanedWhere[]);
        return (first?.row ?? null) as never;
      },
      async findMany({ model, where, limit, sortBy, offset }) {
        let rows = (await findRows(model, (where ?? []) as CleanedWhere[])).map(
          ({ row }) => row,
        );
        if (sortBy) {
          const direction = sortBy.direction === "asc" ? 1 : -1;
          rows = rows.sort(
            (a, b) => compare(a[sortBy.field], b[sortBy.field]) * direction,
          );
        }
        return rows.slice(offset ?? 0, (offset ?? 0) + limit) as never;
      },
      async count({ model, where }) {
        return (await findRows(model, (where ?? []) as CleanedWhere[])).length;
      },
      async update({ model, where, update }) {
        const [first] = await findRows(model, where as CleanedWhere[]);
        if (!first) return null;
        await first.ref.update(update as DocumentData);
        return { ...first.row, ...(update as Row) } as never;
      },
      async updateMany({ model, where, update }) {
        const rows = await findRows(model, where as CleanedWhere[]);
        const batch = db.batch();
        for (const { ref } of rows) batch.update(ref, update as DocumentData);
        if (rows.length > 0) await batch.commit();
        return rows.length;
      },
      async delete({ model, where }) {
        await deleteRows(model, await findRows(model, where as CleanedWhere[]));
      },
      async deleteMany({ model, where }) {
        const rows = await findRows(model, where as CleanedWhere[]);
        await deleteRows(model, rows);
        return rows.length;
      },
      async consumeOne({ model, where }) {
        return db.runTransaction(async (tx) => {
          const [first] = await findRows(model, where as CleanedWhere[], tx);
          if (!first) return null;
          tx.delete(first.ref);
          return first.row as never;
        });
      },
    }),
  });
}
