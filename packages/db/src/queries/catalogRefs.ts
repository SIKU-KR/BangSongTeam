import { inArray } from "drizzle-orm";
import { lyricsCatalog } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * 서버가 모르는 `catalogId`를 `null`로 떨군 덱 행을 돌려준다.
 *
 * `decks.catalog_id`는 `lyrics_catalog`를 참조하는 외래키이고 D1은 이를 강제한다.
 * M5부터 서버가 `catalogId`를 채우므로, 운영자가 카탈로그를 나누거나 지운 뒤
 * 옛 id를 든 세트가 동기화로 들어오면 `db.batch()` 전체가 롤백된다 — M4의
 * 배경 외래키 사고(`nullifyUnknownBackgrounds`)와 같은 모양이다.
 * 카탈로그 연결은 부가 정보이므로, 모르는 id는 '연결 없음'으로 낮춰 받는다.
 */
export async function nullifyUnknownCatalogs<
  T extends { catalogId?: string | null },
>(db: DbInstance, rows: T[]): Promise<T[]> {
  const candidates = [
    ...new Set(
      rows
        .map((row) => row.catalogId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (candidates.length === 0) return rows;

  const found: { id: string }[] = await db
    .select({ id: lyricsCatalog.id })
    .from(lyricsCatalog)
    .where(inArray(lyricsCatalog.id, candidates));
  const known = new Set(found.map((row) => row.id));

  return rows.map((row) =>
    typeof row.catalogId === "string" && !known.has(row.catalogId)
      ? { ...row, catalogId: null }
      : row,
  );
}
