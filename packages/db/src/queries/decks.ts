import { eq, and, desc, sql } from "drizzle-orm";
import { decks, decksFts, lyricsVersions, type Deck } from "../schema";

// Type-flexible SQLite database interface (supports Cloudflare D1 Drizzle client & SQLite test instances)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * FTS5 쿼리 새니타이저
 * 특수문자 및 FTS5 제어 연산자(AND, OR, NOT, NEAR, *, (), ") 주입 공격 방지
 */
export function sanitizeFts5Query(query: string): string {
  // 영문/한글/숫자/공백만 남기고 모든 특수기호 제거
  const cleaned = query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  // 각 토큰을 큰따옴표로 감싸 안전한 MATCH 구문 생성: "은혜로운" "찬양"
  return tokens.map((t) => `"${t}"`).join(" ");
}

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
    .where(and(eq(decks.id, deckId), eq(decks.visibility, "public")));
  return result ?? null;
}

/**
 * 4. FTS5 Trigram + LIKE 하이브리드 고속 검색 (새니타이징 적용)
 */
export async function searchPublicDecks(
  db: DbInstance,
  query: string,
  limit = 20,
): Promise<Deck[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (trimmed.length >= 3) {
    const sanitizedFts = sanitizeFts5Query(trimmed);
    if (!sanitizedFts) return [];

    // 3자 이상: FTS5 Trigram MATCH 쿼리
    const rows = await db
      .select({ deck: decks })
      .from(decks)
      .innerJoin(decksFts, eq(decks.id, decksFts.deckId))
      .where(
        and(
          eq(decks.visibility, "public"),
          sql`decks_fts MATCH ${sanitizedFts}`,
        ),
      )
      .orderBy(desc(decks.forkCount))
      .limit(limit);

    return rows.map((r: { deck: Deck }) => r.deck);
  } else {
    // 2자 이하: LIKE 쿼리 안전 폴백
    return db
      .select()
      .from(decks)
      .where(
        and(
          eq(decks.visibility, "public"),
          sql`(${decks.title} LIKE ${`%${trimmed}%`} OR ${decks.artist} LIKE ${`%${trimmed}%`})`,
        ),
      )
      .orderBy(desc(decks.forkCount))
      .limit(limit);
  }
}

/**
 * 5. 가사 버전 1인 1표 멱등적 업서트 (Upsert)
 */
export async function upsertLyricVersion(
  db: DbInstance,
  params: {
    catalogId: string;
    userId: string;
    deckId: string;
    lyrics: string;
    source?: string;
  },
) {
  return db
    .insert(lyricsVersions)
    .values({
      id: crypto.randomUUID(),
      catalogId: params.catalogId,
      userId: params.userId,
      deckId: params.deckId,
      lyrics: params.lyrics,
      source: params.source ?? "user",
    })
    .onConflictDoUpdate({
      target: [lyricsVersions.userId, lyricsVersions.catalogId],
      set: {
        lyrics: params.lyrics,
        deckId: params.deckId,
        updatedAt: sql`(unixepoch())`,
      },
    });
}

export function createDeckQueries(db: DbInstance) {
  return {
    getMyLibraryDecks: (userId: string) => getMyLibraryDecks(db, userId),
    getByIdScoped: (deckId: string, userId: string) =>
      getByIdScoped(db, deckId, userId),
    getPublicById: (deckId: string) => getPublicById(db, deckId),
    searchPublicDecks: (query: string, limit = 20) =>
      searchPublicDecks(db, query, limit),
    upsertLyricVersion: (params: Parameters<typeof upsertLyricVersion>[1]) =>
      upsertLyricVersion(db, params),
  };
}

export const deckQueries = {
  sanitizeFts5Query,
  getMyLibraryDecks,
  getByIdScoped,
  getPublicById,
  searchPublicDecks,
  upsertLyricVersion,
  createDeckQueries,
};
