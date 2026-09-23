import { asc, inArray } from "drizzle-orm";
import { backgrounds, type Background } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * 모션 배경 메타데이터 전체 목록 조회
 */
export async function getBackgrounds(db: DbInstance): Promise<Background[]> {
  return db.select().from(backgrounds).orderBy(asc(backgrounds.title));
}

/**
 * 서버가 모르는 `backgroundId`를 `null`로 떨군 덱 행을 돌려준다.
 *
 * `decks.background_id`는 `backgrounds`를 참조하는 외래키이고, **D1은 외래키를 기본으로
 * 강제한다.** 알 수 없는 id가 하나라도 섞이면 `db.batch()` 전체가 롤백되어 5곡 세트가
 * 통째로 저장되지 않는다. 배경은 장식이고 가사는 봉사자가 만든 작업물이다 — 배경 하나
 * 때문에 작업 전체를 잃는 쪽이 훨씬 나쁘므로, 모르는 배경은 '배경 없음'으로 낮춰 받고
 * 나머지는 저장한다.
 *
 * 사전 주입 배경 10건은 마이그레이션(`0002_seed_backgrounds.sql`)이 넣으므로 정상 경로에서
 * 이 함수가 무언가를 떨굴 일은 없다. 아직 서버에 없는 id(사용자 커스텀 배경, PRD 4.3)가
 * 흘러들어올 때를 위한 안전망이다.
 */
export async function nullifyUnknownBackgrounds<
  T extends { backgroundId?: string | null },
>(db: DbInstance, rows: T[]): Promise<T[]> {
  const candidates = [
    ...new Set(
      rows
        .map((row) => row.backgroundId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (candidates.length === 0) return rows;

  const found: { id: string }[] = await db
    .select({ id: backgrounds.id })
    .from(backgrounds)
    .where(inArray(backgrounds.id, candidates));
  const known = new Set(found.map((row) => row.id));

  return rows.map((row) =>
    typeof row.backgroundId === "string" && !known.has(row.backgroundId)
      ? { ...row, backgroundId: null }
      : row,
  );
}
