import { eq, and, asc, desc } from "drizzle-orm";
import {
  setlists,
  setlistItems,
  decks,
  type Setlist,
  type Deck,
} from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export interface HydratedSetlistItem {
  id: string;
  setlistId: string;
  deckId: string;
  order: number;
  deck: Deck;
}

export interface SetlistWithDecks extends Setlist {
  items: HydratedSetlistItem[];
}

/**
 * 1. 콘티(Setlist) 및 속한 덱 목록 원자적 조회
 * RLS 부재 대응: setlist.userId 일치 여부를 필수 검증
 */
export async function getSetlistWithDecks(
  db: DbInstance,
  setlistId: string,
  userId: string,
): Promise<SetlistWithDecks | null> {
  const [setlist] = await db
    .select()
    .from(setlists)
    .where(and(eq(setlists.id, setlistId), eq(setlists.userId, userId)));

  if (!setlist) return null;

  const rows = await db
    .select({
      item: setlistItems,
      deck: decks,
    })
    .from(setlistItems)
    .innerJoin(decks, eq(setlistItems.deckId, decks.id))
    .where(eq(setlistItems.setlistId, setlistId))
    .orderBy(asc(setlistItems.order));

  return {
    ...setlist,
    items: rows.map(
      (r: { item: typeof setlistItems.$inferSelect; deck: Deck }) => ({
        id: r.item.id,
        setlistId: r.item.setlistId,
        deckId: r.item.deckId,
        order: r.item.order,
        deck: r.deck,
      }),
    ),
  };
}

/**
 * 2. 사용자 소유 콘티 목록 조회
 */
export async function getSetlistsByUserId(
  db: DbInstance,
  userId: string,
): Promise<Setlist[]> {
  return db
    .select()
    .from(setlists)
    .where(eq(setlists.userId, userId))
    .orderBy(desc(setlists.serviceDate), desc(setlists.createdAt));
}

/**
 * 3. Clone-on-Add 콘티 생성 헬퍼
 * 원본 덱을 복제하여 `scope = 'setlist'`, `setlistId = setlist.id`, `forkedFrom = 원본ID`로 격리 저장
 */
export async function createSetlistWithClonedDecks(
  db: DbInstance,
  params: {
    userId: string;
    title: string;
    serviceDate: string;
    sourceDeckIds: string[];
  },
): Promise<SetlistWithDecks> {
  const setlistId = crypto.randomUUID();

  // 1. 콘티 헤더 삽입
  await db.insert(setlists).values({
    id: setlistId,
    userId: params.userId,
    title: params.title,
    serviceDate: params.serviceDate,
  });

  const clonedItems: HydratedSetlistItem[] = [];

  // 2. 원본 덱들을 로드하여 Clone-on-Add 복제본 생성
  for (let order = 0; order < params.sourceDeckIds.length; order++) {
    const sourceId = params.sourceDeckIds[order];
    const [sourceDeck] = await db
      .select()
      .from(decks)
      .where(eq(decks.id, sourceId));

    if (!sourceDeck) {
      throw new Error(`Source deck with id '${sourceId}' not found.`);
    }

    const clonedDeckId = crypto.randomUUID();
    const clonedDeckValues = {
      id: clonedDeckId,
      userId: params.userId,
      catalogId: sourceDeck.catalogId,
      scope: "setlist" as const,
      setlistId: setlistId,
      title: sourceDeck.title,
      artist: sourceDeck.artist,
      lyricsRaw: sourceDeck.lyricsRaw,
      slides: sourceDeck.slides,
      backgroundId: sourceDeck.backgroundId,
      style: sourceDeck.style,
      visibility: "private" as const, // 콘티 복제본은 무조건 비공개
      forkedFrom: sourceDeck.id,
      forkCount: 0,
    };

    await db.insert(decks).values(clonedDeckValues);

    const itemId = crypto.randomUUID();
    await db.insert(setlistItems).values({
      id: itemId,
      setlistId: setlistId,
      deckId: clonedDeckId,
      order,
    });

    const [createdClonedDeck] = await db
      .select()
      .from(decks)
      .where(eq(decks.id, clonedDeckId));

    clonedItems.push({
      id: itemId,
      setlistId,
      deckId: clonedDeckId,
      order,
      deck: createdClonedDeck,
    });
  }

  const [createdSetlist] = await db
    .select()
    .from(setlists)
    .where(eq(setlists.id, setlistId));

  return {
    ...createdSetlist,
    items: clonedItems,
  };
}

/**
 * 4. 콘티 삭제 헬퍼 (ON DELETE CASCADE로 종속 복제 덱 및 아이템 자동 정리)
 */
export async function deleteSetlist(
  db: DbInstance,
  setlistId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(setlists)
    .where(and(eq(setlists.id, setlistId), eq(setlists.userId, userId)));

  return (result.rowsAffected ?? 1) > 0;
}

export function createSetlistQueries(db: DbInstance) {
  return {
    getSetlistWithDecks: (setlistId: string, userId: string) =>
      getSetlistWithDecks(db, setlistId, userId),
    getSetlistsByUserId: (userId: string) => getSetlistsByUserId(db, userId),
    createSetlistWithClonedDecks: (
      params: Parameters<typeof createSetlistWithClonedDecks>[1],
    ) => createSetlistWithClonedDecks(db, params),
    deleteSetlist: (setlistId: string, userId: string) =>
      deleteSetlist(db, setlistId, userId),
  };
}

export const setlistQueries = {
  getSetlistWithDecks,
  getSetlistsByUserId,
  createSetlistWithClonedDecks,
  deleteSetlist,
  createSetlistQueries,
};
