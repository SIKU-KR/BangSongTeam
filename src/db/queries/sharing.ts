import { and, eq, sql } from "drizzle-orm";
import {
  createId,
  firstSlidePreview,
  type Deck as SharedDeck,
  type DeckVisibility,
  type PublicDeckDetail,
  type PublicDeckSummary,
} from "#shared";
import { decks, user, type Deck, type NewDeck } from "../schema";
import { toDeckRow, toSharedDeck } from "./mappers";
import { publicDeckCondition } from "./publicScope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/** 공개 검색 카드: 첫 슬라이드만 */
export function toPublicDeckSummary(
  row: Deck,
  authorName: string,
): PublicDeckSummary {
  const deck = toSharedDeck(row);
  return {
    id: deck.id,
    title: deck.title,
    artist: deck.artist,
    authorName,
    forkedFromAuthorName: deck.forkedFromAuthorName ?? null,
    forkCount: deck.forkCount,
    backgroundId: deck.backgroundId,
    firstSlidePreview: firstSlidePreview(deck.slides),
    slideCount: deck.slides.length,
    updatedAt: deck.updatedAt,
  };
}

/** 공개 덱 상세: 로그인 사용자에게만 주는 전문 */
export function toPublicDeckDetail(
  row: Deck,
  authorName: string,
): PublicDeckDetail {
  const deck = toSharedDeck(row);
  return {
    ...toPublicDeckSummary(row, authorName),
    lyricsRaw: deck.lyricsRaw,
    slides: deck.slides,
    style: deck.style,
  };
}

export type SetVisibilityResult =
  | { status: "ok"; deck: SharedDeck }
  | { status: "not_found" }
  | { status: "not_library" }
  | { status: "taken_down" }
  | { status: "empty" };

/**
 * 보관함 덱의 공개 여부를 변경한다.
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
  if (row.scope !== "library") return { status: "not_library" };

  if (visibility === "public") {
    if (row.takedownAt) return { status: "taken_down" };
    if (toSharedDeck(row).slides.length === 0) return { status: "empty" };
  }

  await db
    .update(decks)
    .set(
      visibility === "public"
        ? { visibility, publishedAt: new Date() }
        : { visibility },
    )
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)));

  const [saved]: Deck[] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, deckId));
  return { status: "ok", deck: toSharedDeck(saved) };
}

async function selectPublicDeckWithAuthor(
  db: DbInstance,
  deckId: string,
): Promise<{ deck: Deck; authorName: string } | null> {
  const [row] = await db
    .select({ deck: decks, authorName: user.name })
    .from(decks)
    .innerJoin(user, eq(user.id, decks.userId))
    .where(and(eq(decks.id, deckId), publicDeckCondition()));
  return row ?? null;
}

/** 공개 덱 상세 (로그인 사용자용 전문). 공개 조건을 벗어나면 null */
export async function getPublicDeckDetail(
  db: DbInstance,
  deckId: string,
): Promise<PublicDeckDetail | null> {
  const row = await selectPublicDeckWithAuthor(db, deckId);
  return row ? toPublicDeckDetail(row.deck, row.authorName) : null;
}

export type ForkResult =
  | { status: "ok"; deck: SharedDeck; alreadyOwned: boolean }
  | { status: "not_found" };

/**
 * 공개 덱을 내 보관함으로 가져온다 (fork).
 *
 * - 원본은 바뀌지 않는다. 복제본에 `forked_from`과 원작자 이름을 남긴다
 * - 복제본은 비공개이고 `origin='fork'`다
 * - 같은 덱을 다시 가져오면 이전 포크를 돌려주고 가져간 횟수를 올리지 않는다
 * - 내 덱이면 그대로 돌려준다 (내가 공개한 곡을 내 세트에 담는 경우)
 *
 * 포크 insert와 원본 `fork_count + 1`은 `batch`로 묶는다. 둘 중 하나만 남으면
 * 인기순이 어긋나거나 가져간 곡이 사라진다.
 */
export async function forkPublicDeck(
  db: DbInstance,
  userId: string,
  sourceId: string,
): Promise<ForkResult> {
  const source = await selectPublicDeckWithAuthor(db, sourceId);
  if (!source) return { status: "not_found" };

  if (source.deck.userId === userId) {
    return {
      status: "ok",
      deck: toSharedDeck(source.deck),
      alreadyOwned: true,
    };
  }

  const [existing]: Deck[] = await db
    .select()
    .from(decks)
    .where(
      and(
        eq(decks.userId, userId),
        eq(decks.forkedFrom, sourceId),
        eq(decks.origin, "fork"),
        eq(decks.scope, "library"),
      ),
    );
  if (existing) {
    return { status: "ok", deck: toSharedDeck(existing), alreadyOwned: true };
  }

  const original = toSharedDeck(source.deck);
  const now = new Date().toISOString();
  const forkRow: NewDeck = toDeckRow({
    ...original,
    id: createId(),
    userId,
    scope: "library",
    presentationId: null,
    visibility: "private",
    forkedFrom: original.id,
    forkedFromAuthorName: source.authorName,
    forkCount: 0,
    origin: "fork",
    publishedAt: null,
    takedownAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const statements = [
    db.insert(decks).values(forkRow),
    db
      .update(decks)
      .set({ forkCount: sql`${decks.forkCount} + 1` })
      .where(eq(decks.id, sourceId)),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement;
  }

  const [saved]: Deck[] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, forkRow.id as string));
  return { status: "ok", deck: toSharedDeck(saved), alreadyOwned: false };
}
