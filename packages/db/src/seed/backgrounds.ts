import { INITIAL_BACKGROUNDS } from "@repo/shared";
import { backgrounds, type NewBackground } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * 기본 모션 비디오 메타데이터.
 * 정본은 @repo/shared의 INITIAL_BACKGROUNDS다.
 */
export const initialBackgrounds: NewBackground[] = INITIAL_BACKGROUNDS.map(
  (bg) => ({
    id: bg.id,
    title: bg.title,
    r2Key: bg.r2Key,
    posterKey: bg.posterKey,
    durationSec: bg.durationSec,
    license: bg.license,
    tags: JSON.stringify(bg.tags),
  }),
);

/**
 * 모션 루프 영상 메타데이터 10건을 D1 SQLite 데이터베이스에 시드 (멱등적 실행 보장).
 *
 * 운영·로컬 D1은 마이그레이션(`0001_initial.sql`)이 채운다. 이 함수는
 * 마이그레이션을 적용하지 않는 테스트 DB(better-sqlite3)용 경로다.
 */
export async function seedBackgrounds(db: DbInstance): Promise<number> {
  for (const item of initialBackgrounds) {
    await db.insert(backgrounds).values(item).onConflictDoNothing();
  }
  return initialBackgrounds.length;
}
