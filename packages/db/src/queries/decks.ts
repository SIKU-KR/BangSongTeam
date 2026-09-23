import { eq, and, desc } from "drizzle-orm";
import type { Deck as SharedDeck } from "@repo/shared";
import { decks, type Deck, type NewDeck } from "../schema";
import { toDeckRow, toSharedDeck } from "./mappers";
import { nullifyUnknownBackgrounds } from "./backgrounds";
import { publicDeckCondition } from "./publicScope";
import { sanitizeFts5Query, searchPublicDecks } from "./search";

// Type-flexible SQLite database interface (supports Cloudflare D1 Drizzle client & SQLite test instances)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * 1. 사용자 본인 소유 '내 라이브러리' 마스터 덱 목록 조회 (프레젠테이션 복제본 제외)
 */
export async function getMyLibraryDecks(
  db: DbInstance,
  userId: string,
): Promise<Deck[]> {
  return db
    .select()
    .from(decks)
    .where(
      and(
        eq(decks.userId, userId),
        eq(decks.scope, "library"), // 프레젠테이션용 복제 덱 필터링 (UI 오염 방지)
      ),
    )
    .orderBy(desc(decks.updatedAt));
}

/**
 * 2. 사용자 본인 소유 덱 단건 조회
 */
export async function getByIdScoped(
  db: DbInstance,
  deckId: string,
  userId: string,
): Promise<Deck | null> {
  const [result] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)));
  return result ?? null;
}

/**
 * 3. 공개 덱 안전 조회 (비공개 덱 유출 원천 차단)
 */
export async function getPublicById(
  db: DbInstance,
  deckId: string,
): Promise<Deck | null> {
  const [result] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), publicDeckCondition()));
  return result ?? null;
}

/**
 * 동기화 PUT이 바꿀 수 없는 서버 소유 필드 (M5).
 *
 * 공개 전환(`setDeckVisibility`)·가져오기(`forkPublicDeck`)·게시 중단(운영 런북)만
 * 이 값을 바꾼다. 클라이언트가 보낸 값을 믿으면 `forkCount`를 부풀려 인기순을
 * 조작하거나, 동의 없이 공개하거나, 포크본을 직접 만든 곡으로 둔갑시킬 수 있다.
 */
const SERVER_OWNED_DECK_FIELDS = [
  "visibility",
  "forkCount",
  "origin",
  "forkedFrom",
  "forkedFromAuthorName",
  "publishedAt",
  "takedownAt",
] as const satisfies ReadonlyArray<keyof NewDeck>;

/** 새 보관함 덱의 서버 소유 필드 기본값 */
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
 * 보관함 덱 업서트 (소유자 강제).
 *
 * D1에는 RLS가 없으므로 `userId`는 세션에서 온 값을 받아 행에 그대로 박는다.
 * 이미 있는 덱이면 소유자가 일치할 때만 갱신한다. 일치하지 않으면 조용히
 * 무시하지 않고 null을 돌려 호출자가 403을 내릴 수 있게 한다.
 *
 * 이 경로는 보관함(`scope='library'`) 전용이다. 세트 복제본은 프레젠테이션
 * 문서로만 저장한다. 공유 필드는 서버 값을 유지한다 (`SERVER_OWNED_DECK_FIELDS`).
 *
 * @returns 저장된 덱. 남의 덱이면 null
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

  // 프레젠테이션 업서트와 같은 이유로 모르는 배경은 null로 낮춰 받는다.
  // 참조 id 하나 때문에 곡 저장 자체가 실패하면 안 된다.
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

export function createDeckQueries(db: DbInstance) {
  return {
    getMyLibraryDecks: (userId: string) => getMyLibraryDecks(db, userId),
    getByIdScoped: (deckId: string, userId: string) =>
      getByIdScoped(db, deckId, userId),
    getPublicById: (deckId: string) => getPublicById(db, deckId),
    searchPublicDecks: (query: string, limit = 20) =>
      searchPublicDecks(db, query, limit),
    upsertDeck: (userId: string, deck: SharedDeck) =>
      upsertDeck(db, userId, deck),
    deleteDeckScoped: (deckId: string, userId: string) =>
      deleteDeckScoped(db, deckId, userId),
  };
}

export const deckQueries = {
  sanitizeFts5Query,
  getMyLibraryDecks,
  getByIdScoped,
  getPublicById,
  searchPublicDecks,
  upsertDeck,
  deleteDeckScoped,
  createDeckQueries,
};
