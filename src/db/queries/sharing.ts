import { and, eq, isNull } from "drizzle-orm";
import {
  createId,
  firstSlidePreview,
  type Deck as SharedDeck,
  type DeckVisibility,
  type PublicDeckDetail,
  type PublicDeckSummary,
} from "#shared";
import { decks, publicDecks, type Deck } from "../schema";
import { parseSlides, parseStyle, toSharedDeck } from "./mappers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export type PublicDeckRow = typeof publicDecks.$inferSelect;

/** 공개 검색 카드: 첫 슬라이드만 */
export function toPublicDeckSummary(row: PublicDeckRow): PublicDeckSummary {
  const slides = parseSlides(row.slides);
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    authorName: row.authorName,
    forkedFromAuthorName: row.forkedFromAuthorName ?? null,
    forkCount: row.forkCount,
    backgroundId: row.backgroundId ?? null,
    firstSlidePreview: firstSlidePreview(slides),
    slideCount: slides.length,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 공개 덱 상세: 로그인 사용자에게만 주는 전문 */
export function toPublicDeckDetail(row: PublicDeckRow): PublicDeckDetail {
  return {
    ...toPublicDeckSummary(row),
    lyricsRaw: row.lyricsRaw,
    slides: parseSlides(row.slides),
    style: parseStyle(row.style),
  };
}

export type SetVisibilityResult =
  | { status: "ok"; deck: SharedDeck }
  | { status: "not_found" }
  | { status: "not_library" }
  | { status: "taken_down" }
  | { status: "empty" };

async function selectDeck(db: DbInstance, deckId: string): Promise<Deck> {
  const [row]: Deck[] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, deckId));
  return row;
}

/**
 * 보관함 곡의 공개 여부를 변경한다. 게시 중단된 곡과 빈 곡은 공개할 수 없다.
 */
export async function setDeckVisibility(
  db: DbInstance,
  userId: string,
  deckId: string,
  visibility: DeckVisibility,
): Promise<SetVisibilityResult> {
  const [row]: Deck[] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)));

  if (!row) return { status: "not_found" };
  if (row.presentationId) return { status: "not_library" };

  if (visibility === "public") {
    if (row.takedownAt) return { status: "taken_down" };
    if (parseSlides(row.slides).length === 0) return { status: "empty" };
  }

  await db
    .update(decks)
    .set(
      visibility === "public"
        ? { visibility, publishedAt: new Date() }
        : { visibility },
    )
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)));

  return { status: "ok", deck: toSharedDeck(await selectDeck(db, deckId)) };
}

async function selectPublicDeck(
  db: DbInstance,
  deckId: string,
): Promise<PublicDeckRow | null> {
  const [row] = await db
    .select()
    .from(publicDecks)
    .where(eq(publicDecks.id, deckId));
  return row ?? null;
}

/** 공개 덱 상세 (로그인 사용자용 전문). 공개 조건을 벗어나면 null */
export async function getPublicDeckDetail(
  db: DbInstance,
  deckId: string,
): Promise<PublicDeckDetail | null> {
  const row = await selectPublicDeck(db, deckId);
  return row ? toPublicDeckDetail(row) : null;
}

export type ForkResult =
  | { status: "ok"; deck: SharedDeck; alreadyOwned: boolean }
  | { status: "not_found" };

/**
 * 공개 덱을 내 보관함으로 가져온다 (fork).
 *
 * - 원본은 바뀌지 않는다. 복제본에 `forked_from`과 원작자 이름을 남긴다
 * - 복제본은 비공개다
 * - 같은 덱을 다시 가져오면 이전 포크를 돌려준다. 한 사람이 한 곡을 한 번만
 *   가져오는 것은 유일 인덱스(`idx_decks_fork_once`)가 보장하므로 동시 요청에도
 *   포크가 둘 생기지 않는다
 * - 내 덱이면 그대로 돌려준다 (내가 공개한 곡을 내 세트에 담는 경우)
 *
 * 원본의 가져간 횟수는 트리거가 올린다.
 */
export async function forkPublicDeck(
  db: DbInstance,
  userId: string,
  sourceId: string,
): Promise<ForkResult> {
  const source = await selectPublicDeck(db, sourceId);
  if (!source) return { status: "not_found" };

  if (source.userId === userId) {
    return {
      status: "ok",
      deck: toSharedDeck(await selectDeck(db, sourceId)),
      alreadyOwned: true,
    };
  }

  const now = new Date();
  const [inserted]: { id: string }[] = await db
    .insert(decks)
    .values({
      id: createId(),
      userId,
      title: source.title,
      artist: source.artist,
      lyricsRaw: source.lyricsRaw,
      slides: source.slides,
      style: source.style,
      backgroundId: source.backgroundId,
      forkedFrom: source.id,
      forkedFromAuthorName: source.authorName,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: decks.id });

  const [saved]: Deck[] = await db
    .select()
    .from(decks)
    .where(
      and(
        eq(decks.userId, userId),
        eq(decks.forkedFrom, sourceId),
        isNull(decks.presentationId),
      ),
    );
  return {
    status: "ok",
    deck: toSharedDeck(saved),
    alreadyOwned: inserted === undefined,
  };
}
