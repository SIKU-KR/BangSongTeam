import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { decks, user, type Deck } from "../schema";
import { publicDeckCondition } from "./publicScope";
import { nullifyUnknownBackgrounds } from "./backgrounds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

const TRIGRAM_MIN_LENGTH = 3;

/**
 * FTS5 쿼리 새니타이저.
 * 특수문자 및 FTS5 제어 연산자 주입을 방지한다.
 */
export function sanitizeFts5Query(query: string): string {
  return tokenize(query)
    .map((t) => `"${t}"`)
    .join(" ");
}

function tokenize(query: string): string[] {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export type SearchPlan =
  | { kind: "browse" }
  | { kind: "nothing" }
  | {
      kind: "search";
      match: string | null;
      likePatterns: string[];
    };

/**
 * 검색어를 토큰 단위로 나눠 MATCH와 LIKE에 배분한다.
 *
 * 문자열 전체 길이로 분기하면 "주 은혜"처럼 짧은 토큰이 섞인 쿼리가 MATCH로 가서
 * 아무것도 찾지 못한다 (trigram은 3자 미만 토큰을 매칭하지 못한다). 토큰마다 나눠
 * 3자 이상은 MATCH, 나머지는 LIKE로 보내고 모두 AND로 묶는다.
 *
 * 글자 수는 코드 포인트 기준이다 (한글 1글자 = 1).
 */
export function planSearch(query: string): SearchPlan {
  if (!query.trim()) return { kind: "browse" };

  const tokens = tokenize(query);
  if (tokens.length === 0) return { kind: "nothing" };

  const long = tokens.filter((t) => [...t].length >= TRIGRAM_MIN_LENGTH);
  const short = tokens.filter((t) => [...t].length < TRIGRAM_MIN_LENGTH);

  return {
    kind: "search",
    match: long.length > 0 ? long.map((t) => `"${t}"`).join(" ") : null,
    likePatterns: short.map((t) => `%${escapeLike(t)}%`),
  };
}

function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function likeAny(columns: SQL[], pattern: string): SQL {
  return sql`(${sql.join(
    columns.map((col) => sql`${col} LIKE ${pattern} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

export interface PublicDeckSearchRow {
  deck: Deck;
  authorName: string;
}

/**
 * 공개 덱 검색 — 제목·아티스트·가사 본문 (FTS5 trigram + LIKE 하이브리드).
 *
 * 공개 조건(`publicDeckCondition`)은 이 함수 안에 고정되어 있다. 결과는 가져간
 * 횟수순, 동률이면 최근 수정순이다. 작성자의 커스텀 배경은 떼어 낸다.
 */
export async function searchPublicDecks(
  db: DbInstance,
  query: string,
  limit = 20,
): Promise<PublicDeckSearchRow[]> {
  const plan = planSearch(query);
  if (plan.kind === "nothing") return [];

  const conditions: SQL[] = [publicDeckCondition() as SQL];
  if (plan.kind === "search") {
    if (plan.match) {
      conditions.push(
        sql`${decks.id} IN (SELECT deck_id FROM decks_fts WHERE decks_fts MATCH ${plan.match})`,
      );
    }
    for (const pattern of plan.likePatterns) {
      conditions.push(
        likeAny(
          [sql`${decks.title}`, sql`${decks.artist}`, sql`${decks.lyricsRaw}`],
          pattern,
        ),
      );
    }
  }

  const rows: PublicDeckSearchRow[] = await db
    .select({ deck: decks, authorName: user.name })
    .from(decks)
    .innerJoin(user, eq(user.id, decks.userId))
    .where(and(...conditions))
    .orderBy(desc(decks.forkCount), desc(decks.updatedAt))
    .limit(limit);

  const masked = await nullifyUnknownBackgrounds(
    db,
    rows.map((row) => row.deck),
  );
  return rows.map((row, index) => ({ ...row, deck: masked[index] }));
}
