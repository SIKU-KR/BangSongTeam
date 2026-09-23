import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { RootVersion } from "@repo/shared";
import { lyricsCatalog, lyricsVersions, type LyricsCatalog } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/**
 * 정규화 시작 시점의 카탈로그 상태.
 *
 * 모델 응답을 기다리는 동안(수 초) 새 버전이 들어올 수 있다. D1에는 대화형
 * 트랜잭션이 없으므로, 쓰기 직전에 이 값이 그대로인지 비교해 옛 입력으로 만든
 * 결과가 새 상태를 덮지 않게 한다.
 */
export interface CatalogRevision {
  updatedAt: Date | null;
  versionCount: number;
}

export interface NormalizationInput {
  catalog: LyricsCatalog;
  versions: RootVersion[];
  revision: CatalogRevision;
}

/** 카탈로그와 그 루트 버전들 (등록순) */
export async function getNormalizationInput(
  db: DbInstance,
  catalogId: string,
): Promise<NormalizationInput | null> {
  const [catalog]: LyricsCatalog[] = await db
    .select()
    .from(lyricsCatalog)
    .where(eq(lyricsCatalog.id, catalogId));
  if (!catalog) return null;

  const rows: { lyrics: string; createdAt: Date | null }[] = await db
    .select({
      lyrics: lyricsVersions.lyrics,
      createdAt: lyricsVersions.createdAt,
    })
    .from(lyricsVersions)
    .where(eq(lyricsVersions.catalogId, catalogId))
    .orderBy(asc(lyricsVersions.createdAt), asc(lyricsVersions.id));

  return {
    catalog,
    versions: rows.map((row) => ({
      lyrics: row.lyrics,
      createdAt: row.createdAt ?? new Date(0),
    })),
    revision: {
      updatedAt: catalog.updatedAt,
      versionCount: catalog.versionCount,
    },
  };
}

/**
 * 정규화 결과를 대표 가사로 쓴다 (compare-and-set).
 *
 * - 잠긴 곡(`status='locked'`)은 쓰지 않는다 — 운영자 정본 보호 (PRD 4.8 교정)
 * - 시작 시점 revision과 다르면 쓰지 않는다 — 그사이 들어온 새 버전이 다음 정규화를 부른다
 *
 * @returns 실제로 썼는지
 */
export async function applyCanonical(
  db: DbInstance,
  catalogId: string,
  params: {
    canonical: string;
    source: "llm" | "popular_root";
    expected: CatalogRevision;
  },
): Promise<boolean> {
  const revisionMatches = params.expected.updatedAt
    ? eq(lyricsCatalog.updatedAt, params.expected.updatedAt)
    : sql`${lyricsCatalog.updatedAt} IS NULL`;

  // RETURNING으로 실제로 바뀐 행이 있는지 본다 (D1·SQLite 모두 지원).
  const updated: { id: string }[] = await db
    .update(lyricsCatalog)
    .set({
      lyricsCanonical: params.canonical,
      status: "normalized",
      canonicalSource: params.source,
      normalizedAt: new Date(),
      // revision을 넘겨 같은 입력으로 뒤늦게 끝난 다른 정규화가 덮지 못하게 한다
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lyricsCatalog.id, catalogId),
        ne(lyricsCatalog.status, "locked"),
        eq(lyricsCatalog.versionCount, params.expected.versionCount),
        revisionMatches,
      ),
    )
    .returning({ id: lyricsCatalog.id });

  return updated.length > 0;
}
