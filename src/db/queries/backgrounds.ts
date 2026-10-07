import { asc, inArray } from "drizzle-orm";
import { mediaUrlForKey, type BackgroundMedia } from "#shared";
import {
  backgroundKeywords,
  backgrounds,
  type Background,
  type BackgroundKeyword,
} from "../schema";
import { runQueries } from "./batch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export function toBackgroundMedia(
  row: Background,
  keywords: string[] = [],
): BackgroundMedia {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    mediaUrl: mediaUrlForKey(row.r2Key),
    posterUrl: mediaUrlForKey(row.posterKey),
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    license: row.license,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    keywords,
  };
}

/** 배경 갤러리: 모든 사용자에게 같은 목록을 제목순으로 준다 */
export async function listBackgrounds(
  db: DbInstance,
): Promise<BackgroundMedia[]> {
  const [rows, keywordRows] = (await runQueries(db, [
    db.select().from(backgrounds).orderBy(asc(backgrounds.title)),
    db
      .select()
      .from(backgroundKeywords)
      .orderBy(asc(backgroundKeywords.keyword)),
  ])) as [Background[], BackgroundKeyword[]];

  const keywordsById = new Map<string, string[]>();
  for (const { backgroundId, keyword } of keywordRows) {
    const list = keywordsById.get(backgroundId) ?? [];
    list.push(keyword);
    keywordsById.set(backgroundId, list);
  }
  return rows.map((row) => toBackgroundMedia(row, keywordsById.get(row.id)));
}

function distinctBackgroundIds(
  rows: readonly { backgroundId?: string | null }[],
): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.backgroundId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

function replaceMissing<T extends { backgroundId?: string | null }>(
  rows: T[],
  keep: Set<string>,
): T[] {
  return rows.map((row) =>
    typeof row.backgroundId === "string" && !keep.has(row.backgroundId)
      ? { ...row, backgroundId: null }
      : row,
  );
}

/**
 * `nullifyUnknownBackgrounds`의 조회를 다른 읽기와 한 batch에 묶을 때 쓴다.
 * 확인할 배경이 없으면 `null`이다. 결과는 `keepKnownBackgrounds`에 넘긴다.
 */
export function knownBackgroundsQuery(
  db: DbInstance,
  rows: readonly { backgroundId?: string | null }[],
): unknown {
  const candidates = distinctBackgroundIds(rows);
  if (candidates.length === 0) return null;
  return db
    .select({ id: backgrounds.id })
    .from(backgrounds)
    .where(inArray(backgrounds.id, candidates));
}

export function keepKnownBackgrounds<
  T extends { backgroundId?: string | null },
>(rows: T[], found: readonly { id: string }[]): T[] {
  return replaceMissing(rows, new Set(found.map((row) => row.id)));
}

/**
 * 없는 배경을 가리키는 `backgroundId`를 `null`로 떨군 덱 행을 돌려준다.
 *
 * 저장 경로: `decks.background_id`는 `backgrounds`를 참조하는 외래키이고, **D1은
 * 외래키를 기본으로 강제한다.** 알 수 없는 id가 하나라도 섞이면 `db.batch()` 전체가
 * 롤백되어 5곡 세트가 통째로 저장되지 않는다. 배경은 장식이고 가사는 봉사자가 만든
 * 작업물이다 — 배경 하나 때문에 작업 전체를 잃는 쪽이 훨씬 나쁘므로, 모르는 배경은
 * '배경 없음'으로 낮춰 받고 나머지는 저장한다.
 *
 * 읽기 경로에는 필요 없다. 배경을 지우면 외래키(SET NULL)가 곡의 배경을 비운다.
 */
export async function nullifyUnknownBackgrounds<
  T extends { backgroundId?: string | null },
>(db: DbInstance, rows: T[]): Promise<T[]> {
  const query = knownBackgroundsQuery(db, rows);
  if (query === null) return rows;
  return keepKnownBackgrounds(rows, (await query) as { id: string }[]);
}
