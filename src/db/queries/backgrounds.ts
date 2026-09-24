import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  BACKGROUND_UPLOAD_LIMITS,
  BackgroundTagsSchema,
  USER_BACKGROUND_LICENSE,
  mediaUrlForKey,
  type BackgroundKind,
  type BackgroundMedia,
  type BackgroundStorageUsage,
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
 * 이 사용자가 쓸 수 있는 배경만 고르는 조건: 사전 주입 배경 + 본인 업로드.
 * 남의 커스텀 배경은 목록에도, 곡의 배경 참조에도 들어오지 못한다.
 */
function visibleTo(userId: string | null) {
  const service = eq(backgrounds.source, "service");
  if (!userId) return service;
  return or(
    service,
    and(eq(backgrounds.source, "user"), eq(backgrounds.ownerUserId, userId)),
  );
}

/**
 * 배경 목록: 사전 주입 배경(제목순) 뒤에 내 업로드(최신순).
 * 비로그인이면 사전 주입 배경만 준다.
 */
export async function listVisibleBackgrounds(
  db: DbInstance,
  userId: string | null,
): Promise<BackgroundMedia[]> {
  const rows: Background[] = await db
    .select()
    .from(backgrounds)
    .where(visibleTo(userId))
    .orderBy(asc(backgrounds.title));

  const service = rows.filter((row) => row.source === "service");
  const mine = rows
    .filter((row) => row.source === "user")
    .sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
  return [...service, ...mine].map(toBackgroundMedia);
}

/** 계정당 300MB 한도를 집계한다. 포스터 크기까지 포함한다 */
export async function getBackgroundUsage(
  db: DbInstance,
  userId: string,
): Promise<BackgroundStorageUsage> {
  const [row]: { usedBytes: number | null }[] = await db
    .select({
      usedBytes: sql<number>`COALESCE(SUM(${backgrounds.sizeBytes}), 0)`,
    })
    .from(backgrounds)
    .where(
      and(eq(backgrounds.source, "user"), eq(backgrounds.ownerUserId, userId)),
    );
  return {
    usedBytes: Number(row?.usedBytes ?? 0),
    limitBytes: BACKGROUND_UPLOAD_LIMITS.maxAccountBytes,
  };
}

export interface NewUserBackground {
  id: string;
  title: string;
  kind: BackgroundKind;
  mediaKey: string;
  posterKey: string;
  sizeBytes: number;
  durationSec: number;
  tags: string[];
}

/**
 * 사용자 커스텀 배경 메타데이터를 남긴다.
 * R2 객체를 먼저 올린 뒤에 부른다. 파일 없는 행은 깨진 배경이 된다.
 */
export async function insertUserBackground(
  db: DbInstance,
  userId: string,
  input: NewUserBackground,
): Promise<BackgroundMedia> {
  await db.insert(backgrounds).values({
    id: input.id,
    title: input.title,
    r2Key: input.mediaKey,
    posterKey: input.posterKey,
    durationSec: input.durationSec,
    license: USER_BACKGROUND_LICENSE,
    tags: JSON.stringify(input.tags),
    source: "user",
    ownerUserId: userId,
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
 * 본인 커스텀 배경을 지우고 R2에서 지울 키를 돌려준다. 남의 배경이나 사전 주입
 * 배경이면 아무것도 지우지 않고 null이다.
 *
 * 이 배경을 쓰던 곡은 `decks.background_id`의 `ON DELETE SET NULL`로 배경 없음이 된다.
 */
export async function deleteUserBackground(
  db: DbInstance,
  userId: string,
  backgroundId: string,
): Promise<{ mediaKey: string; posterKey: string } | null> {
  const [row]: { r2Key: string; posterKey: string }[] = await db
    .delete(backgrounds)
    .where(
      and(
        eq(backgrounds.id, backgroundId),
        eq(backgrounds.source, "user"),
        eq(backgrounds.ownerUserId, userId),
      ),
    )
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
 * 이 사용자가 쓸 수 없는 `backgroundId`를 `null`로 떨군 덱 행을 돌려준다.
 *
 * `decks.background_id`는 `backgrounds`를 참조하는 외래키이고, **D1은 외래키를 기본으로
 * 강제한다.** 알 수 없는 id가 하나라도 섞이면 `db.batch()` 전체가 롤백되어 5곡 세트가
 * 통째로 저장되지 않는다. 배경은 장식이고 가사는 봉사자가 만든 작업물이다 — 배경 하나
 * 때문에 작업 전체를 잃는 쪽이 훨씬 나쁘므로, 모르는 배경은 '배경 없음'으로 낮춰 받고
 * 나머지는 저장한다.
 *
 * 남의 커스텀 배경 id도 같은 취급이다. 행이 있어 외래키는 통과하지만, 소유자만
 * 쓴다는 규칙을 깨고 남의 업로드를 내 곡에 걸게 된다.
 */
export async function nullifyUnknownBackgrounds<
  T extends { backgroundId?: string | null },
>(db: DbInstance, userId: string, rows: T[]): Promise<T[]> {
  const candidates = distinctBackgroundIds(rows);
  if (candidates.length === 0) return rows;

  const found: { id: string }[] = await db
    .select({ id: backgrounds.id })
    .from(backgrounds)
    .where(and(inArray(backgrounds.id, candidates), visibleTo(userId)));
  return replaceMissing(rows, new Set(found.map((row) => row.id)));
}

/**
 * 공개 경로(검색·상세·포크)로 나가는 덱에서 사전 주입 배경이 아닌 배경을 떼어 낸다.
 *
 * 커스텀 배경은 소유자 본인만 쓴다. 공개 덱이 소유자의 업로드를 가리키고 있어도
 * 다른 사용자에게는 '배경 없음'으로 보이고, 포크본도 배경 없이 만들어진다.
 */
export async function maskNonServiceBackgrounds<
  T extends { backgroundId?: string | null },
>(db: DbInstance, rows: T[]): Promise<T[]> {
  const candidates = distinctBackgroundIds(rows);
  if (candidates.length === 0) return rows;

  const found: { id: string }[] = await db
    .select({ id: backgrounds.id })
    .from(backgrounds)
    .where(
      and(
        inArray(backgrounds.id, candidates),
        eq(backgrounds.source, "service"),
      ),
    );
  return replaceMissing(rows, new Set(found.map((row) => row.id)));
}
