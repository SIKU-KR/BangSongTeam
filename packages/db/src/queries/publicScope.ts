import { and, eq, isNull } from "drizzle-orm";
import { decks } from "../schema";

/**
 * 공개 덱 판정 조건 (M5, CLAUDE.md §6.2 Public Visibility Safeguard).
 *
 * 공개 경로로 나가는 모든 조회는 이 조건을 거친다. 라우트에서 따로 조립하지 않는다.
 * - 보관함 덱만: 세트 복제본(scope='presentation')은 공유 대상이 아니다
 * - 공개로 전환된 것만
 * - 운영자가 게시를 중단하지 않은 것만
 *
 * `0004_m5_fts.sql`의 FTS 트리거 조건과 같다. 둘 중 하나만 바꾸지 않는다.
 */
export function publicDeckCondition() {
  return and(
    eq(decks.scope, "library"),
    eq(decks.visibility, "public"),
    isNull(decks.takedownAt),
  );
}
