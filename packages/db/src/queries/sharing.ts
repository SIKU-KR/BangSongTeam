import { and, eq, sql } from "drizzle-orm";
import {
  createId,
  firstSlidePreview,
  type Deck as SharedDeck,
  type DeckVisibility,
  type PublicDeckDetail,
  type PublicDeckSummary,
} from "@repo/shared";
import { decks, user, type Deck, type NewDeck } from "../schema";
import { toDeckRow, toSharedDeck } from "./mappers";
import { publicDeckCondition } from "./publicScope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

// ============================================================================
// 공개 응답 모양 (PRD 4.7)
//
// DB 행을 그대로 내보내지 않는다. `userId`처럼 남에게 보일 이유가 없는 값을
// 여기서 떨어뜨리고, 공개 검색에는 미리보기만 남긴다.
// ============================================================================

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

// ============================================================================
// 공개 전환 (PRD 4.7 공유 선택)
// ============================================================================

export type SetVisibilityResult =
  | { status: "ok"; deck: SharedDeck }
  /** 없거나 남의 덱 (둘을 구분하지 않는다 — 남의 비공개 덱 존재 여부가 새지 않게) */
  | { status: "not_found" }
  /** 세트 복제본은 공유 단위가 아니다 */
  | { status: "not_library" }
  /** 운영자가 게시를 중단한 덱은 다시 공개할 수 없다 */
  | { status: "taken_down" }
  /** 슬라이드가 없는 곡은 공개하지 않는다 */
  | { status: "empty" };

/**
 * 내 보관함 덱의 공개 여부를 바꾼다.
 *
 * 공개로 돌릴 때 `published_at`을 남긴다. 이것이 '공개 전 저작권 안내에 동의했다'는
 * 기록이다 (동의 자체는 요청 스키마가 `true` 리터럴로 강제한다).
 * 비공개로 돌려도 이미 가져간 포크는 그대로 남는다 (PRD 4.7 비공개 전환·삭제).
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

// ============================================================================
// 공개 덱 조회·가져오기 (PRD 4.7 검색·가져오기)
// ============================================================================

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
