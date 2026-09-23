import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { decks, user, type Deck } from "../schema";
import { publicDeckCondition } from "./publicScope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/** trigram 토크나이저가 MATCH로 찾을 수 있는 최소 길이 (TECH_SPEC §7.6) */
const TRIGRAM_MIN_LENGTH = 3;

/**
 * FTS5 쿼리 새니타이저
 * 특수문자 및 FTS5 제어 연산자(AND, OR, NOT, NEAR, *, (), ") 주입 공격 방지
 */
export function sanitizeFts5Query(query: string): string {
  return tokenize(query)
    .map((t) => `"${t}"`)
    .join(" ");
}

/** 글자·숫자만 남겨 공백 기준으로 자른다. 따옴표·연산자·와일드카드가 여기서 사라진다 */
function tokenize(query: string): string[] {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export type SearchPlan =
  /** 빈 쿼리: 인기순 둘러보기 */
  | { kind: "browse" }
  /** 입력은 있었지만 검색할 글자가 남지 않았다 (예: "%%") */
  | { kind: "nothing" }
  | {
      kind: "search";
      /** 3자 이상 토큰 → FTS5 MATCH 식 (`"은혜로" "사랑"`) */
      match: string | null;
      /** 2자 이하 토큰 → LIKE 패턴 (`%주%`) */
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

/** LIKE 와일드카드를 리터럴로. 토큰화에서 이미 빠지지만 헬퍼가 방어를 스스로 갖는다 */
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
 * 횟수순(PRD 4.7), 동률이면 최근 수정순이다.
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

  return rows;
}
