import { eq, and, desc, isNull } from "drizzle-orm";
import type { Deck as SharedDeck } from "#shared";
import { decks, type Deck } from "../schema";
import { toDeckContent, toSharedDeck } from "./mappers";
import { nullifyUnknownBackgrounds } from "./backgrounds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/** 보관함 곡 조건 (프레젠테이션 사본 제외) */
const isLibraryDeck = isNull(decks.presentationId);

/**
 * 사용자 본인 소유 보관함 곡 목록 조회 (프레젠테이션 사본 제외).
 */
export async function getMyLibraryDecks(
  db: DbInstance,
  userId: string,
): Promise<Deck[]> {
  return db
    .select()
    .from(decks)
    .where(and(eq(decks.userId, userId), isLibraryDeck))
    .orderBy(desc(decks.updatedAt));
}

/**
 * 보관함 곡 업서트. 클라이언트가 보낸 곡 내용만 쓴다.
 *
 * 공개 상태·가져온 곡 정보·가져간 횟수는 공개 설정·가져오기 API와 트리거가 정하는
 * 값이라 이 경로로는 바뀌지 않는다. 남의 곡이거나 프레젠테이션 사본이면 null이다.
 */
export async function upsertDeck(
  db: DbInstance,
  userId: string,
  deck: SharedDeck,
): Promise<SharedDeck | null> {
  const [existing]: Pick<Deck, "userId" | "presentationId">[] = await db
    .select({ userId: decks.userId, presentationId: decks.presentationId })
    .from(decks)
    .where(eq(decks.id, deck.id));

  if (existing && (existing.userId !== userId || existing.presentationId)) {
    return null;
  }

  const [content] = await nullifyUnknownBackgrounds(db, [toDeckContent(deck)]);

  if (existing) {
    await db
      .update(decks)
      .set(content)
      .where(and(eq(decks.id, deck.id), eq(decks.userId, userId)));
  } else {
    await db.insert(decks).values({ ...content, id: deck.id, userId });
  }

  const [saved]: Deck[] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, deck.id));
  return saved ? toSharedDeck(saved) : null;
}

/** 본인 소유 보관함 곡 삭제 */
export async function deleteDeckScoped(
  db: DbInstance,
  deckId: string,
  userId: string,
): Promise<boolean> {
  const [owned] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId), isLibraryDeck));

  if (!owned) return false;

  await db.delete(decks).where(eq(decks.id, deckId));
  return true;
}
