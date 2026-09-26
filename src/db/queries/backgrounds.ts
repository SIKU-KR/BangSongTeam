import { and, asc, eq, inArray } from "drizzle-orm";
import {
  BackgroundTagsSchema,
  mediaUrlForKey,
  type BackgroundKind,
  type BackgroundMedia,
} from "#shared";
import { backgrounds, type Background } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

function parseTags(raw: string): string[] {
  try {
    const parsed = BackgroundTagsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function toBackgroundMedia(row: Background): BackgroundMedia {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    kind: row.kind,
    mediaUrl: mediaUrlForKey(row.r2Key),
    posterUrl: mediaUrlForKey(row.posterKey),
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    license: row.license,
    tags: parseTags(row.tags),
    createdAt: (row.createdAt ?? new Date(0)).toISOString(),
  };
}

/**
 * 앱이 다루는 배경은 기본 제공 배경뿐이다. 예전 사용자 업로드 행(`source='user'`)은
 * 마이그레이션 `0002`가 지웠고, 혹시 남아 있어도 어떤 경로로도 나가지 않는다.
 */
const isService = eq(backgrounds.source, "service");

/** 배경 갤러리: 모든 사용자에게 같은 목록을 제목순으로 준다 */
export async function listBackgrounds(
  db: DbInstance,
): Promise<BackgroundMedia[]> {
  const rows: Background[] = await db
    .select()
    .from(backgrounds)
    .where(isService)
    .orderBy(asc(backgrounds.title));
  return rows.map(toBackgroundMedia);
}

export interface NewServiceBackground {
  id: string;
  title: string;
  license: string;
  kind: BackgroundKind;
  mediaKey: string;
  posterKey: string;
  sizeBytes: number;
  durationSec: number;
  tags: string[];
}

/**
 * 관리자가 올린 배경을 기본 제공 배경으로 남긴다.
 * R2 객체를 먼저 올린 뒤에 부른다. 파일 없는 행은 깨진 배경이 된다.
 */
export async function insertServiceBackground(
  db: DbInstance,
  input: NewServiceBackground,
): Promise<BackgroundMedia> {
  await db.insert(backgrounds).values({
    id: input.id,
    title: input.title,
    r2Key: input.mediaKey,
    posterKey: input.posterKey,
    durationSec: input.durationSec,
    license: input.license,
    tags: JSON.stringify(input.tags),
    source: "service",
    kind: input.kind,
    sizeBytes: input.sizeBytes,
  });

  const [row]: Background[] = await db
    .select()
    .from(backgrounds)
    .where(eq(backgrounds.id, input.id));
  return toBackgroundMedia(row);
}

/**
 * 기본 제공 배경을 지우고 R2에서 지울 키를 돌려준다. 없는 배경이면 null이다.
 *
 * 이 배경을 쓰던 모든 사용자의 곡은 `decks.background_id`의 `ON DELETE SET NULL`로
 * 배경 없음이 된다. 호출하는 쪽은 행을 먼저 지우고 R2 객체를 나중에 지운다.
 */
export async function deleteServiceBackground(
  db: DbInstance,
  backgroundId: string,
): Promise<{ mediaKey: string; posterKey: string } | null> {
  const [row]: { r2Key: string; posterKey: string }[] = await db
    .delete(backgrounds)
    .where(and(eq(backgrounds.id, backgroundId), isService))
    .returning({ r2Key: backgrounds.r2Key, posterKey: backgrounds.posterKey });
  return row ? { mediaKey: row.r2Key, posterKey: row.posterKey } : null;
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
    .where(and(inArray(backgrounds.id, candidates), isService));
}

export function keepKnownBackgrounds<
  T extends { backgroundId?: string | null },
>(rows: T[], found: readonly { id: string }[]): T[] {
  return replaceMissing(rows, new Set(found.map((row) => row.id)));
}

/**
 * 기본 제공 배경이 아닌 `backgroundId`를 `null`로 떨군 덱 행을 돌려준다.
 *
 * 저장 경로: `decks.background_id`는 `backgrounds`를 참조하는 외래키이고, **D1은
 * 외래키를 기본으로 강제한다.** 알 수 없는 id가 하나라도 섞이면 `db.batch()` 전체가
 * 롤백되어 5곡 세트가 통째로 저장되지 않는다. 배경은 장식이고 가사는 봉사자가 만든
 * 작업물이다 — 배경 하나 때문에 작업 전체를 잃는 쪽이 훨씬 나쁘므로, 모르는 배경은
 * '배경 없음'으로 낮춰 받고 나머지는 저장한다.
 *
 * 공개 경로(검색·상세·포크): 지워진 배경이나 예전 사용자 업로드를 가리키는 덱도
 * '배경 없음'으로 내보낸다.
 */
export async function nullifyUnknownBackgrounds<
  T extends { backgroundId?: string | null },
>(db: DbInstance, rows: T[]): Promise<T[]> {
  const query = knownBackgroundsQuery(db, rows);
  if (query === null) return rows;
  return keepKnownBackgrounds(rows, (await query) as { id: string }[]);
}
