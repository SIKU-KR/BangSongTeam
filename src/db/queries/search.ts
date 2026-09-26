import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { SlideSchema, type PublicDeckSummary } from "#shared";
import { backgrounds, decks, decksFts, user } from "../schema";
import { publicDeckCondition } from "./publicScope";
import { isServiceBackground } from "./backgrounds";

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
    likePatterns: short.map((t) => `%${t}%`),
  };
}

function fts5Match(query: string): SQL {
  return sql`${decksFts} MATCH ${query}`;
}

/**
 * 첫 슬라이드(`order`가 가장 작은 슬라이드, 같으면 앞의 것)의 `lines` JSON.
 * `firstSlidePreview`와 같은 규칙을 D1 안에서 계산해 `slides` 전체를 Worker로 가져오지 않는다.
 * 깨진 JSON 한 행 때문에 검색 전체가 실패하지 않도록 `json_valid`로 거른다.
 */
const firstSlideLines = sql<
  string | null
>`CASE WHEN json_valid(${decks.slides}) THEN (SELECT json_extract(value, '$.lines') FROM json_each(${decks.slides}) ORDER BY json_extract(value, '$.order'), key LIMIT 1) END`;

const slideCount = sql<number>`CASE WHEN json_valid(${decks.slides}) THEN json_array_length(${decks.slides}) ELSE 0 END`;

interface PublicDeckSearchRow {
  id: string;
  title: string;
  artist: string | null;
  authorName: string;
  forkedFromAuthorName: string | null;
  forkCount: number;
  backgroundId: string | null;
  firstSlideLines: string | null;
  slideCount: number;
  updatedAt: Date | null;
}

function parseLines(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = SlideSchema.shape.lines.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function toSummary(row: PublicDeckSearchRow): PublicDeckSummary {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist ?? "",
    authorName: row.authorName,
    forkedFromAuthorName: row.forkedFromAuthorName,
    forkCount: row.forkCount,
    backgroundId: row.backgroundId,
    firstSlidePreview: parseLines(row.firstSlideLines),
    slideCount: row.slideCount,
    updatedAt: (row.updatedAt ?? new Date(0)).toISOString(),
  };
}

/**
 * 공개 덱 검색 — 제목·아티스트·가사 본문 (FTS5 trigram + LIKE 하이브리드).
 *
 * 공개 조건(`publicDeckCondition`)은 이 함수 안에 고정되어 있다. 결과는 가져간
 * 횟수순, 동률이면 최근 수정순이다.
 *
 * 검색 카드에 필요한 열만 D1 왕복 한 번으로 읽는다. 가사 원문(`lyrics_raw`)과
 * `style`은 읽지 않고, 첫 슬라이드와 슬라이드 수는 D1 안에서 계산한다. 기본 제공
 * 배경이 아닌 `background_id`(지워진 배경, 예전 사용자 업로드)는 `LEFT JOIN`으로
 * 걸러 `null`이 된다.
 */
export async function searchPublicDecks(
  db: DbInstance,
  query: string,
  limit = 20,
): Promise<PublicDeckSummary[]> {
  const plan = planSearch(query);
  if (plan.kind === "nothing") return [];

  const conditions: SQL[] = [publicDeckCondition() as SQL];
  if (plan.kind === "search") {
    if (plan.match) {
      conditions.push(
        inArray(
          decks.id,
          db
            .select({ deckId: decksFts.deckId })
            .from(decksFts)
            .where(fts5Match(plan.match)),
        ),
      );
    }
    for (const pattern of plan.likePatterns) {
      conditions.push(
        or(
          like(decks.title, pattern),
          like(decks.artist, pattern),
          like(decks.lyricsRaw, pattern),
        ) as SQL,
      );
    }
  }

  const rows: PublicDeckSearchRow[] = await db
    .select({
      id: decks.id,
      title: decks.title,
      artist: decks.artist,
      authorName: user.name,
      forkedFromAuthorName: decks.forkedFromAuthorName,
      forkCount: decks.forkCount,
      backgroundId: backgrounds.id,
      firstSlideLines,
      slideCount,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .innerJoin(user, eq(user.id, decks.userId))
    .leftJoin(
      backgrounds,
      and(eq(backgrounds.id, decks.backgroundId), isServiceBackground),
    )
    .where(and(...conditions))
    .orderBy(desc(decks.forkCount), desc(decks.updatedAt))
    .limit(limit);

  return rows.map(toSummary);
}
