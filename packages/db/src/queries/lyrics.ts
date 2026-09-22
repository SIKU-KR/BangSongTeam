import { eq, and, sql } from "drizzle-orm";
import { buildCatalogKey } from "@repo/shared";
import { lyricsCatalog, lyricsVersions } from "../schema";
import { upsertLyricVersion } from "./decks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export interface ContributeLyricsParams {
  userId: string;
  deckId: string;
  title: string;
  artist: string;
  lyrics: string;
}

export interface ContributeLyricsResult {
  catalogId: string;
  versionCount: number;
  /** 운영자가 잠근 카탈로그라 정본을 건드리지 않았다 */
  locked: boolean;
}

/**
 * 가사를 공용 카탈로그에 기여한다.
 *
 * 정규화 키로 카탈로그를 찾고, 없으면 만든 뒤 사용자의 루트 버전을 올린다.
 * `lyrics_versions`에 `(user_id, catalog_id)` 유니크가 걸려 있어 같은 사용자가
 * 같은 곡을 여러 번 저장해도 버전은 하나다 (1인 1표).
 *
 * AI 정규화는 M5다. 여기서는 버전 저장까지만 한다.
 */
export async function contributeLyrics(
  db: DbInstance,
  params: ContributeLyricsParams,
): Promise<ContributeLyricsResult> {
  const { titleNorm, artistNorm } = buildCatalogKey(
    params.title,
    params.artist,
  );

  const [existing] = await db
    .select()
    .from(lyricsCatalog)
    .where(
      and(
        eq(lyricsCatalog.titleNorm, titleNorm),
        eq(lyricsCatalog.artistNorm, artistNorm),
      ),
    );

  let catalogId: string;
  let locked = false;

  if (existing) {
    catalogId = existing.id;
    locked = existing.status === "locked";
  } else {
    catalogId = crypto.randomUUID();
    await db.insert(lyricsCatalog).values({
      id: catalogId,
      title: params.title,
      artist: params.artist,
      titleNorm,
      artistNorm,
      // 첫 기여는 그대로 정본이 된다 (비교할 다른 버전이 없다).
      lyricsCanonical: params.lyrics,
      versionCount: 1,
      status: "single",
    });
  }

  await upsertLyricVersion(db, {
    catalogId,
    userId: params.userId,
    deckId: params.deckId,
    lyrics: params.lyrics,
  });

  const rows = await db
    .select({ id: lyricsVersions.id })
    .from(lyricsVersions)
    .where(eq(lyricsVersions.catalogId, catalogId));
  const versionCount = rows.length;

  // 운영자가 검수해 잠근 정본은 건드리지 않는다 (PRD 4.8).
  if (!locked) {
    await db
      .update(lyricsCatalog)
      .set({ versionCount, updatedAt: sql`(unixepoch())` })
      .where(eq(lyricsCatalog.id, catalogId));
  } else {
    await db
      .update(lyricsCatalog)
      .set({ versionCount })
      .where(eq(lyricsCatalog.id, catalogId));
  }

  return { catalogId, versionCount, locked };
}

export function createLyricsQueries(db: DbInstance) {
  return {
    contributeLyrics: (params: ContributeLyricsParams) =>
      contributeLyrics(db, params),
  };
}

export const lyricsQueries = {
  contributeLyrics,
  createLyricsQueries,
};
