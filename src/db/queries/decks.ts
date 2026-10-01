import { eq, and, desc } from "drizzle-orm";
import type { Deck as SharedDeck } from "#shared";
import { decks, type Deck, type NewDeck } from "../schema";
import { toDeckRow, toSharedDeck } from "./mappers";
import { nullifyUnknownBackgrounds } from "./backgrounds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * 사용자 본인 소유 보관함 마스터 덱 목록 조회 (프레젠테이션 복제본 제외).
 */
export async function getMyLibraryDecks(
  db: DbInstance,
  userId: string,
): Promise<Deck[]> {
  return db
    .select()
    .from(decks)
    .where(and(eq(decks.userId, userId), eq(decks.scope, "library")))
    .orderBy(desc(decks.updatedAt));
}

const SERVER_OWNED_DECK_FIELDS = [
  "visibility",
  "forkCount",
  "origin",
  "forkedFrom",
  "forkedFromAuthorName",
  "publishedAt",
  "takedownAt",
] as const satisfies ReadonlyArray<keyof NewDeck>;

const NEW_DECK_SERVER_FIELDS: Pick<
  NewDeck,
  (typeof SERVER_OWNED_DECK_FIELDS)[number]
> = {
  visibility: "private",
  forkCount: 0,
  origin: "user",
  forkedFrom: null,
  forkedFromAuthorName: null,
  publishedAt: null,
  takedownAt: null,
};

/**
 * 보관함 덱 업서트. 타인 소유 덱이면 null을 반환한다.
 */
export async function upsertDeck(
  db: DbInstance,
  userId: string,
  deck: SharedDeck,
): Promise<SharedDeck | null> {
  const [existing]: Deck[] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, deck.id));

  if (existing && existing.userId !== userId) return null;

  const clientRow = toDeckRow({
    ...deck,
    userId,
    scope: "library",
    presentationId: null,
  });

  const serverFields = existing
    ? Object.fromEntries(
        SERVER_OWNED_DECK_FIELDS.map((key) => [key, existing[key]]),
      )
    : NEW_DECK_SERVER_FIELDS;

  const [row] = await nullifyUnknownBackgrounds(db, [
    { ...clientRow, ...serverFields },
  ]);

  if (existing) {
    await db.update(decks).set(row).where(eq(decks.id, deck.id));
  } else {
    await db.insert(decks).values(row);
  }

  const [saved]: Deck[] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, deck.id));
  return toSharedDeck(saved);
}

/** 본인 소유 덱 삭제 */
export async function deleteDeckScoped(
  db: DbInstance,
  deckId: string,
  userId: string,
): Promise<boolean> {
  const [owned] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)));

  if (!owned) return false;

  await db.delete(decks).where(eq(decks.id, deckId));
  return true;
}
