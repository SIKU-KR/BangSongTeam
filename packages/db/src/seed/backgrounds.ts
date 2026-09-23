import { INITIAL_BACKGROUNDS } from "@repo/shared";
import { backgrounds, type NewBackground } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * PRD M0 규격 10개 기본 모션 비디오 메타데이터.
 *
 * **정본은 `@repo/shared`의 `INITIAL_BACKGROUNDS` 하나다.** 예전에는 같은 데이터가
 * 여기, 공용 상수, `seed.sql` 세 군데에 손으로 복제되어 있었다. 배경을 하나 고칠 때
 * 한 곳만 고치면 클라이언트가 만드는 `backgroundId`와 D1의 `backgrounds` 행이
 * 어긋나고, 그 순간 `decks.background_id` 외래키 때문에 동기화가 통째로 깨진다.
 *
 * 남은 사본은 마이그레이션 `drizzle/0002_seed_backgrounds.sql` 하나뿐이며(정적 SQL이라
 * 파생시킬 수 없다), `backgrounds.test.ts`가 둘을 대조해 갈라지지 못하게 막는다.
 */
export const initialBackgrounds: NewBackground[] = INITIAL_BACKGROUNDS.map(
  (bg) => ({
    id: bg.id,
    title: bg.title,
    r2Key: bg.r2Key,
    posterKey: bg.posterKey,
    durationSec: bg.durationSec,
    license: bg.license,
    // D1에는 JSON TEXT로 담는다 (TECH_SPEC 4.0-2).
    tags: JSON.stringify(bg.tags),
  }),
);

/**
 * 모션 루프 영상 메타데이터 10건을 D1 SQLite 데이터베이스에 시드 (멱등적 실행 보장).
 *
 * 운영·로컬 D1은 마이그레이션(`0002_seed_backgrounds.sql`)이 채운다. 이 함수는
 * 마이그레이션을 적용하지 않는 테스트 DB(better-sqlite3)용 경로다.
 */
export async function seedBackgrounds(db: DbInstance): Promise<number> {
  for (const item of initialBackgrounds) {
    await db.insert(backgrounds).values(item).onConflictDoNothing();
  }
  return initialBackgrounds.length;
}
