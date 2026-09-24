import { and, eq, isNull } from "drizzle-orm";
import { decks } from "../schema";

/**
 * 공개 덱 판정 조건.
 * 보관함 덱(scope='library'), 공개 상태(visibility='public'), 미게시중단(takedownAt IS NULL)을 강제한다.
 */
export function publicDeckCondition() {
  return and(
    eq(decks.scope, "library"),
    eq(decks.visibility, "public"),
    isNull(decks.takedownAt),
  );
}
