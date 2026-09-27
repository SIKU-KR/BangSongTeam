// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * D1은 batch()를 제공하지만 테스트용 better-sqlite3 클라이언트에는 없다.
 * 있으면 원자적으로, 없으면 순차 실행으로 떨어뜨린다.
 */
export async function runStatements(
  db: DbInstance,
  statements: unknown[],
): Promise<void> {
  if (typeof db.batch === "function" && statements.length > 0) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) {
    await statement;
  }
}

/**
 * 서로 기다릴 필요가 없는 읽기 쿼리를 D1 왕복 한 번에 보낸다. 결과는 넘긴 순서대로
 * 돌려주며, `null` 자리는 보내지 않고 빈 배열로 채운다. batch가 없는 테스트
 * 클라이언트에서는 순서대로 await한다.
 */
export async function runQueries(
  db: DbInstance,
  queries: readonly unknown[],
): Promise<unknown[][]> {
  const present = queries.filter((query) => query !== null);
  let results: unknown[][];
  if (typeof db.batch === "function" && present.length > 0) {
    results = await db.batch(present);
  } else {
    results = [];
    for (const query of present) results.push((await query) as unknown[]);
  }
  let next = 0;
  return queries.map((query) => (query === null ? [] : results[next++]));
}

/**
 * D1은 쿼리 하나에 바인딩 변수를 100개까지만 받는다. `inArray`에 넘길 id를
 * 이 크기로 나눈다.
 */
export const MAX_IDS_PER_STATEMENT = 50;

export function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_STATEMENT) {
    chunks.push(ids.slice(i, i + MAX_IDS_PER_STATEMENT));
  }
  return chunks;
}
