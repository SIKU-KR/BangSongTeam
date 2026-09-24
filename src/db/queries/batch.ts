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
