import { eq, and, ne, sql } from "drizzle-orm";
import { buildCatalogKey, type Deck as SharedDeck } from "@repo/shared";
import { decks, lyricsCatalog, lyricsVersions } from "../schema";
import { upsertLyricVersion } from "./decks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export interface ContributeLyricsParams {
  userId: string;
  deckId: string;
  title: string;
  artist: string;
  lyrics: string;
  /**
   * '이 곡이 맞나요?'(PRD 4.8 곡 식별)에서 사용자가 고른 카탈로그.
   * 존재하고 제목 정규화 키가 같을 때만 쓴다. 아니면 정규화 키로 찾는다.
   */
  preferredCatalogId?: string | null;
}

export interface ContributeLyricsResult {
  catalogId: string;
  versionCount: number;
  /** 운영자가 잠근 카탈로그라 정본을 건드리지 않았다 */
  locked: boolean;
  /** 버전이 새로 생겼거나 가사가 바뀌었다 (정규화 재실행 조건, PRD 4.8 정규화 시점) */
  changed: boolean;
}

/**
 * 이 덱이 가사 라이브러리의 '루트 버전'인가 (PRD 4.8 정규화 대상).
 *
 * 루트는 사용자가 직접 붙여넣어 등록한 가사다. 공유 덱을 가져온 포크본(`fork`)이나
 * 대표 가사로 만든 덱(`catalog`)은 버전으로 세지 않는다 — 같은 원본에서 갈라진
 * 복제본이 여러 표로 계산되면 다수결이 왜곡된다.
 *
 * 반드시 서버에 저장된 덱(`upsertDeck` 반환값)으로 판정한다. `origin`은 서버 소유다.
 */
export function shouldContribute(deck: SharedDeck): boolean {
  return (
    deck.scope === "library" &&
    (deck.origin ?? "user") === "user" &&
    deck.contributeToCatalog === true &&
    deck.lyricsRaw.trim().length > 0
  );
}

async function findCatalogByKey(
  db: DbInstance,
  titleNorm: string,
  artistNorm: string,
) {
  const [row] = await db
    .select()
    .from(lyricsCatalog)
    .where(
      and(
        eq(lyricsCatalog.titleNorm, titleNorm),
        eq(lyricsCatalog.artistNorm, artistNorm),
      ),
    );
  return row ?? null;
}

async function countVersions(db: DbInstance, catalogId: string) {
  const rows = await db
    .select({ id: lyricsVersions.id })
    .from(lyricsVersions)
    .where(eq(lyricsVersions.catalogId, catalogId));
  return rows.length as number;
}

/**
 * 가사를 공용 카탈로그에 기여한다.
 *
 * 정규화 키로 카탈로그를 찾고, 없으면 만든 뒤 사용자의 루트 버전을 올린다.
 * `lyrics_versions`에 `(user_id, catalog_id)` 유니크가 걸려 있어 같은 사용자가
 * 같은 곡을 여러 번 저장해도 버전은 하나다 (1인 1표).
 *
 * AI 정규화는 여기서 하지 않는다. 호출자가 `changed`와 `versionCount`를 보고
 * 백그라운드로 돌린다 (M5-4).
 */
export async function contributeLyrics(
  db: DbInstance,
  params: ContributeLyricsParams,
): Promise<ContributeLyricsResult> {
  const { titleNorm, artistNorm } = buildCatalogKey(
    params.title,
    params.artist,
  );

  let catalog = null;

  // 사용자가 고른 후보. 제목이 다른 곡으로 표를 옮기는 것은 허용하지 않는다
  // (아티스트 표기만 다른 같은 곡을 묶는 것이 곡 식별의 목적이다).
  if (params.preferredCatalogId) {
    const [preferred] = await db
      .select()
      .from(lyricsCatalog)
      .where(eq(lyricsCatalog.id, params.preferredCatalogId));
    if (preferred && preferred.titleNorm === titleNorm) catalog = preferred;
  }

  if (!catalog) catalog = await findCatalogByKey(db, titleNorm, artistNorm);

  if (!catalog) {
    // 동시에 들어온 첫 기여 두 건이 카탈로그를 둘로 만들지 않도록 unique 키에
    // 기대고, 진 쪽은 이긴 쪽 행을 다시 읽는다.
    await db
      .insert(lyricsCatalog)
      .values({
        id: crypto.randomUUID(),
        title: params.title,
        artist: params.artist,
        titleNorm,
        artistNorm,
        // 첫 기여는 그대로 정본이 된다 (비교할 다른 버전이 없다).
        lyricsCanonical: params.lyrics,
        versionCount: 0,
        status: "single",
        canonicalSource: "user",
      })
      .onConflictDoNothing();
    catalog = await findCatalogByKey(db, titleNorm, artistNorm);
  }

  const catalogId: string = catalog.id;
  const locked = catalog.status === "locked";

  const [previous] = await db
    .select({ lyrics: lyricsVersions.lyrics })
    .from(lyricsVersions)
    .where(
      and(
        eq(lyricsVersions.userId, params.userId),
        eq(lyricsVersions.catalogId, catalogId),
      ),
    );
  const changed = !previous || previous.lyrics !== params.lyrics;

  if (changed) {
    await upsertLyricVersion(db, {
      catalogId,
      userId: params.userId,
      deckId: params.deckId,
      lyrics: params.lyrics,
    });
  }

  // 같은 덱이 제목을 바꿔 다른 곡으로 옮겨 갔다면, 옛 곡에 남은 그 덱의 표를 거둔다.
  // 남겨 두면 이제 다른 곡이 된 가사가 옛 곡의 다수결에 계속 참여한다.
  const stale: { catalogId: string }[] = await db
    .select({ catalogId: lyricsVersions.catalogId })
    .from(lyricsVersions)
    .where(
      and(
        eq(lyricsVersions.userId, params.userId),
        eq(lyricsVersions.deckId, params.deckId),
        ne(lyricsVersions.catalogId, catalogId),
      ),
    );
  for (const { catalogId: oldId } of stale) {
    await db
      .delete(lyricsVersions)
      .where(
        and(
          eq(lyricsVersions.userId, params.userId),
          eq(lyricsVersions.deckId, params.deckId),
          eq(lyricsVersions.catalogId, oldId),
        ),
      );
    await db
      .update(lyricsCatalog)
      .set({ versionCount: await countVersions(db, oldId) })
      .where(eq(lyricsCatalog.id, oldId));
  }

  const versionCount = await countVersions(db, catalogId);

  // 등록 1명인 곡은 그 사람의 원본이 곧 대표 가사다 (PRD 4.8 표시: '1명 등록').
  // 그 사람이 가사를 고치면 대표 가사도 따라간다. 잠긴 곡은 운영자 정본을 지킨다.
  const set: Record<string, unknown> = { versionCount };
  if (!locked && changed) {
    set.updatedAt = sql`(unixepoch())`;
    if (versionCount === 1) {
      set.lyricsCanonical = params.lyrics;
      set.status = "single";
      set.canonicalSource = "user";
    }
  }
  await db
    .update(lyricsCatalog)
    .set(set)
    .where(eq(lyricsCatalog.id, catalogId));

  // 덱이 어느 곡에 묶였는지 되써 둔다 (편집기의 '1명 등록' 표시, 교정 신고 대상)
  await db
    .update(decks)
    .set({ catalogId })
    .where(and(eq(decks.id, params.deckId), eq(decks.userId, params.userId)));

  return { catalogId, versionCount, locked, changed };
}

export function createLyricsQueries(db: DbInstance) {
  return {
    contributeLyrics: (params: ContributeLyricsParams) =>
      contributeLyrics(db, params),
  };
}

export const lyricsQueries = {
  contributeLyrics,
  shouldContribute,
  createLyricsQueries,
};
