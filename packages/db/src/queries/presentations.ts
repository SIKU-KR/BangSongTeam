import { eq, and, asc, desc } from "drizzle-orm";
import {
  presentations,
  presentationItems,
  decks,
  type Presentation,
  type Deck,
} from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export interface HydratedPresentationItem {
  id: string;
  presentationId: string;
  deckId: string;
  order: number;
  deck: Deck;
}

export interface PresentationWithDecks extends Presentation {
  items: HydratedPresentationItem[];
}

/**
 * 1. 프레젠테이션(Presentation) 및 속한 덱 목록 원자적 조회
 * RLS 부재 대응: presentation.userId 일치 여부를 필수 검증
 */
export async function getPresentationWithDecks(
  db: DbInstance,
  presentationId: string,
  userId: string,
): Promise<PresentationWithDecks | null> {
  const [presentation] = await db
    .select()
    .from(presentations)
    .where(
      and(
        eq(presentations.id, presentationId),
        eq(presentations.userId, userId),
      ),
    );

  if (!presentation) return null;

  const rows = await db
    .select({
      item: presentationItems,
      deck: decks,
    })
    .from(presentationItems)
    .innerJoin(decks, eq(presentationItems.deckId, decks.id))
    .where(eq(presentationItems.presentationId, presentationId))
    .orderBy(asc(presentationItems.order));

  return {
    ...presentation,
    items: rows.map(
      (r: { item: typeof presentationItems.$inferSelect; deck: Deck }) => ({
        id: r.item.id,
        presentationId: r.item.presentationId,
        deckId: r.item.deckId,
        order: r.item.order,
        deck: r.deck,
      }),
    ),
  };
}

/**
 * 2. 사용자 소유 프레젠테이션 목록 조회
 */
export async function getPresentationsByUserId(
  db: DbInstance,
  userId: string,
): Promise<Presentation[]> {
  return db
    .select()
    .from(presentations)
    .where(eq(presentations.userId, userId))
    .orderBy(desc(presentations.serviceDate), desc(presentations.createdAt));
}

/**
 * 3. Clone-on-Add 프레젠테이션 생성 헬퍼
 * 원본 덱을 복제하여 `scope = 'presentation'`, `presentationId = presentation.id`, `forkedFrom = 원본ID`로 격리 저장
 */
export async function createPresentationWithClonedDecks(
  db: DbInstance,
  params: {
    userId: string;
    title: string;
    serviceDate: string;
    sourceDeckIds: string[];
  },
): Promise<PresentationWithDecks> {
  const presentationId = crypto.randomUUID();

  // 1. 프레젠테이션 헤더 삽입
  await db.insert(presentations).values({
    id: presentationId,
    userId: params.userId,
    title: params.title,
    serviceDate: params.serviceDate,
  });

  const clonedItems: HydratedPresentationItem[] = [];

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
      scope: "presentation" as const,
      presentationId: presentationId,
      title: sourceDeck.title,
      artist: sourceDeck.artist,
      lyricsRaw: sourceDeck.lyricsRaw,
      slides: sourceDeck.slides,
      backgroundId: sourceDeck.backgroundId,
      style: sourceDeck.style,
      visibility: "private" as const, // 프레젠테이션 복제본은 무조건 비공개
      forkedFrom: sourceDeck.id,
      forkCount: 0,
    };

    await db.insert(decks).values(clonedDeckValues);

    const itemId = crypto.randomUUID();
    await db.insert(presentationItems).values({
      id: itemId,
      presentationId: presentationId,
      deckId: clonedDeckId,
      order,
    });

    const [createdClonedDeck] = await db
      .select()
      .from(decks)
      .where(eq(decks.id, clonedDeckId));

    clonedItems.push({
      id: itemId,
      presentationId,
      deckId: clonedDeckId,
      order,
      deck: createdClonedDeck,
    });
  }

  const [createdPresentation] = await db
    .select()
    .from(presentations)
    .where(eq(presentations.id, presentationId));

  return {
    ...createdPresentation,
    items: clonedItems,
  };
}

/**
 * 4. 프레젠테이션 삭제 헬퍼 (ON DELETE CASCADE로 종속 복제 덱 및 아이템 자동 정리)
 */
export async function deletePresentation(
  db: DbInstance,
  presentationId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(presentations)
    .where(
      and(
        eq(presentations.id, presentationId),
        eq(presentations.userId, userId),
      ),
    );

  return (result.rowsAffected ?? 1) > 0;
}

export function createPresentationQueries(db: DbInstance) {
  return {
    getPresentationWithDecks: (presentationId: string, userId: string) =>
      getPresentationWithDecks(db, presentationId, userId),
    getPresentationsByUserId: (userId: string) =>
      getPresentationsByUserId(db, userId),
    createPresentationWithClonedDecks: (
      params: Parameters<typeof createPresentationWithClonedDecks>[1],
    ) => createPresentationWithClonedDecks(db, params),
    deletePresentation: (presentationId: string, userId: string) =>
      deletePresentation(db, presentationId, userId),
  };
}

export const presentationQueries = {
  getPresentationWithDecks,
  getPresentationsByUserId,
  createPresentationWithClonedDecks,
  deletePresentation,
  createPresentationQueries,
};
