import { FieldValue, type Transaction } from "@google-cloud/firestore";
import {
  createId,
  firstSlidePreview,
  fitDeckText,
  OFFICIAL_LIBRARY_USER_ID,
  toDisplayName,
  toNonNegativeInt,
  type Deck as SharedDeck,
  type DeckVisibility,
  type PublicDeckDetail,
  type PublicDeckSummary,
} from "#shared";
import type { Db } from "../client";
import { decksCol, usersCol, type DeckDoc } from "../collections";
import { withDeckIndex } from "../deckIndex";
import { readTombstone } from "./cascade";
import { readLibraryLimits } from "./limits";
import { parseSlides, parseStyle, toSharedDeck } from "./mappers";
import { libraryDeckDefaults } from "./decks";

/** 공유 라이브러리에 보이는 곡과 작성자 이름(`toDisplayName`으로 다듬은 값) */
export type PublicDeck = DeckDoc & { authorName: string };

/**
 * 공개 검색 카드: 첫 슬라이드만.
 *
 * 글 필드와 가져간 횟수는 `toSharedDeck`처럼 스키마 한도에 맞춰 읽는다. 검색 응답은 카드
 * 여러 장을 한 번에 검사하므로 곡 하나의 잘못된 값이 검색 결과 전체를 깨뜨린다.
 */
export function toPublicDeckSummary(row: PublicDeck): PublicDeckSummary {
  const slides = parseSlides(row.slides);
  const text = fitDeckText(row);
  return {
    id: row.id,
    title: text.title,
    artist: text.artist,
    authorName: row.authorName,
    forkedFromAuthorName: text.forkedFromAuthorName,
    forkCount: toNonNegativeInt(row.forkCount),
    backgroundId: row.backgroundId ?? null,
    firstSlidePreview: firstSlidePreview(slides),
    slideCount: slides.length,
    updatedAt: row.updatedAt.toISOString(),
    official: row.userId === OFFICIAL_LIBRARY_USER_ID,
  };
}

/** 공개 덱 상세: 로그인 사용자에게만 주는 전문 */
export function toPublicDeckDetail(row: PublicDeck): PublicDeckDetail {
  return {
    ...toPublicDeckSummary(row),
    lyricsRaw: row.lyricsRaw,
    slides: parseSlides(row.slides),
    style: parseStyle(row.style),
  };
}

/**
 * 곡 문서들에 작성자 이름을 붙인다. 작성자 문서가 없는 곡은 공유 라이브러리에서 뺀다
 * (작성자 없는 공개 곡을 보이지 않던 예전 조인과 같다).
 *
 * 이름은 `toDisplayName`으로 다듬는다. 한 사람의 이름이 숫자·객체·긴 문자열로 저장돼 있어도
 * 그 사람의 곡이 든 검색 응답이 모든 사용자에게서 깨지지 않게 한다.
 */
export async function withAuthorNames(
  db: Db,
  decks: DeckDoc[],
): Promise<PublicDeck[]> {
  const userIds = [...new Set(decks.map((deck) => deck.userId))];
  if (userIds.length === 0) return [];
  const users = await db.getAll(...userIds.map((id) => usersCol(db).doc(id)));
  const names = new Map(
    users.flatMap((snapshot) => {
      const user = snapshot.data();
      return user ? [[snapshot.id, toDisplayName(user.name)] as const] : [];
    }),
  );
  return decks.flatMap((deck) => {
    const authorName = names.get(deck.userId);
    return authorName === undefined ? [] : [{ ...deck, authorName }];
  });
}

export type SetVisibilityResult =
  | { status: "ok"; deck: SharedDeck }
  | { status: "not_found" }
  | { status: "not_library" }
  | { status: "taken_down" }
  | { status: "empty" }
  | { status: "deleted" }
  | { status: "banned" }
  | { status: "rate_limited" };

async function isForkSourceTakenDown(
  tx: Transaction,
  db: Db,
  row: DeckDoc,
): Promise<boolean> {
  if (!row.forkedFrom) return false;
  const source = (await tx.get(decksCol(db).doc(row.forkedFrom))).data();
  return Boolean(source?.takedownAt);
}

/**
 * 보관함 곡의 공개 여부를 변경한다. 게시 중단된 곡과 빈 곡은 공개할 수 없다.
 *
 * 가져온 곡은 원본이 게시 중단됐으면 공개할 수 없다(`taken_down`). 가져간 사본은 지우지 않고
 * 남기므로, 막지 않으면 게시 중단한 가사가 사본으로 곧바로 다시 올라온다. 원본의 게시 중단을
 * 풀면 다시 공개할 수 있다.
 *
 * 운영자가 제한한 계정은 공개할 수 없고(`banned`), 그날 공개 한도(`DAILY_USER_LIMITS.publish`)를
 * 다 썼으면 `rate_limited`다. 한도는 비공개 곡을 공개할 때만 센다. 이미 공개한 곡을 다시 공개하거나
 * 비공개로 돌리는 것은 세지도 막지도 않는다.
 *
 * 내가 지운 곡(삭제 기록이 있는 id)은 문서가 다시 생겨 있어도 바꾸지 않고 `deleted`다. 옛
 * 리비전이 되살린 문서를 공개해 주면, 그 곡은 주인의 보관함 목록(`GET /api/decks`)에서는 가려진
 * 채 공유 라이브러리에 남는다.
 */
export async function setDeckVisibility(
  db: Db,
  userId: string,
  deckId: string,
  visibility: DeckVisibility,
  now: Date = new Date(),
): Promise<SetVisibilityResult> {
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deckId);
    const [row, record, limits] = await Promise.all([
      tx.get(ref).then((snapshot) => snapshot.data()),
      readTombstone(tx, db, "deck", deckId),
      visibility === "public"
        ? readLibraryLimits(tx, db, userId, "publish", now)
        : null,
    ]);

    if (record?.userId === userId) return { status: "deleted" };
    if (!row || row.userId !== userId) return { status: "not_found" };
    if (row.presentationId) return { status: "not_library" };

    if (limits) {
      if (limits.banned) return { status: "banned" };
      if (row.takedownAt) return { status: "taken_down" };
      if (await isForkSourceTakenDown(tx, db, row)) {
        return { status: "taken_down" };
      }
      if (parseSlides(row.slides).length === 0) return { status: "empty" };
      if (row.visibility !== "public") {
        if (limits.quota.exceeded) return { status: "rate_limited" };
        limits.quota.take();
      }
    }

    const updated = withDeckIndex({
      ...row,
      visibility,
      ...(visibility === "public" ? { publishedAt: now } : {}),
    });
    tx.set(ref, updated);
    return { status: "ok", deck: toSharedDeck(updated) };
  });
}

async function readPublicDeck(
  db: Db,
  tx: Transaction | null,
  deckId: string,
): Promise<PublicDeck | null> {
  const ref = decksCol(db).doc(deckId);
  const deck = (await (tx ? tx.get(ref) : ref.get())).data();
  if (!deck?.listed) return null;
  const userRef = usersCol(db).doc(deck.userId);
  const author = (await (tx ? tx.get(userRef) : userRef.get())).data();
  return author ? { ...deck, authorName: toDisplayName(author.name) } : null;
}

/** 공개 덱 상세 (로그인 사용자용 전문). 공개 범위를 벗어나면 null */
export async function getPublicDeckDetail(
  db: Db,
  deckId: string,
): Promise<PublicDeckDetail | null> {
  const row = await readPublicDeck(db, null, deckId);
  return row ? toPublicDeckDetail(row) : null;
}

export type ForkResult =
  | { status: "ok"; deck: SharedDeck; alreadyOwned: boolean }
  | { status: "not_found" }
  | { status: "banned" }
  | { status: "rate_limited" };

/**
 * 공개 덱을 내 보관함으로 가져온다 (fork).
 *
 * - 원본은 바뀌지 않는다. 복제본에 `forkedFrom`과 원작자 이름을 남긴다
 * - 복제본은 비공개다
 * - 같은 덱을 다시 가져오면 이전 포크를 돌려준다. 찾기와 만들기가 한 트랜잭션이라
 *   동시 요청에도 포크가 둘 생기지 않는다
 * - 내 덱이면 그대로 돌려준다 (내가 공개한 곡을 내 세트에 담는 경우)
 * - 제목·아티스트·원작자 이름은 한도에 맞춘 값(`fitDeckText`)을 저장한다. 원본에 한도를 넘는
 *   값이 있어도 복제본은 처음부터 스키마를 통과한다
 *
 * 새로 가져오면 원본의 가져간 횟수를 같은 트랜잭션에서 올린다.
 *
 * 새로 가져오는 것만 막고 센다. 운영자가 제한한 계정은 `banned`, 그날 가져오기 한도
 * (`DAILY_USER_LIMITS.fork`)를 다 썼으면 `rate_limited`다. 이미 가져온 곡과 내 곡은 아무것도 쓰지
 * 않으므로 그대로 돌려준다.
 */
export async function forkPublicDeck(
  db: Db,
  userId: string,
  sourceId: string,
  now: Date = new Date(),
): Promise<ForkResult> {
  return db.runTransaction(async (tx) => {
    const [source, previousForks, limits] = await Promise.all([
      readPublicDeck(db, tx, sourceId),
      tx.get(
        decksCol(db)
          .where("userId", "==", userId)
          .where("forkedFrom", "==", sourceId)
          .where("presentationId", "==", null)
          .limit(1),
      ),
      readLibraryLimits(tx, db, userId, "fork", now),
    ]);
    if (!source) return { status: "not_found" };

    if (source.userId === userId) {
      return { status: "ok", deck: toSharedDeck(source), alreadyOwned: true };
    }

    const previous = previousForks.docs[0]?.data();
    if (previous) {
      return {
        status: "ok",
        deck: toSharedDeck(previous),
        alreadyOwned: true,
      };
    }
    if (limits.banned) return { status: "banned" };
    if (limits.quota.exceeded) return { status: "rate_limited" };

    const fork = withDeckIndex({
      ...libraryDeckDefaults(createId(), userId),
      ...fitDeckText({
        title: source.title,
        artist: source.artist,
        forkedFromAuthorName: source.authorName,
      }),
      lyricsRaw: source.lyricsRaw,
      slides: source.slides,
      style: source.style,
      backgroundId: source.backgroundId,
      forkedFrom: source.id,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(decksCol(db).doc(fork.id), fork);
    tx.update(decksCol(db).doc(source.id), {
      forkCount: FieldValue.increment(1),
    });
    limits.quota.take();
    return { status: "ok", deck: toSharedDeck(fork), alreadyOwned: false };
  });
}
