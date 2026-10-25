import { env } from "cloudflare:test";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createD1Client } from "#db";

/**
 * 테스트 D1의 테이블을 넘긴 순서대로 비운다. 외래키가 강제되므로 자식 테이블을
 * 먼저 넘긴다. 테스트 D1은 파일끼리 공유되므로 `beforeEach`에서 쓴다.
 */
export async function clearTables(...tables: SQLiteTable[]): Promise<void> {
  const db = createD1Client(env.DB);
  for (const table of tables) {
    await db.delete(table);
  }
}
