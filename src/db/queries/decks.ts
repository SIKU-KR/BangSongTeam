import { FieldValue, type Transaction } from "@google-cloud/firestore";
import { isReservedDocumentId, type Deck as SharedDeck } from "#shared";
import type { Db } from "../client";
import {
  backgroundsCol,
  decksCol,
  reportsCol,
  type DeckDoc,
} from "../collections";
import { withDeckIndex } from "../deckIndex";
import { toDeckContent, toSharedDeck } from "./mappers";

/** 최근 수정순 (같으면 id순) */
export function byUpdatedAtDesc(a: DeckDoc, b: DeckDoc): number {
  return (
    b.updatedAt.getTime() - a.updatedAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * 사용자 본인 소유 보관함 곡 목록 조회 (프레젠테이션 사본 제외).
 */
export async function getMyLibraryDecks(
  db: Db,
  userId: string,
): Promise<DeckDoc[]> {
  const snapshot = await decksCol(db)
    .where("userId", "==", userId)
    .where("presentationId", "==", null)
    .get();
  return snapshot.docs.map((doc) => doc.data()).sort(byUpdatedAtDesc);
}

/**
 * 넘긴 배경 id 중 서버에 있는 것만 돌려준다. 곡 저장은 모르는 배경을 '배경 없음'으로
 * 낮춰 받는다. 배경은 장식이고 가사는 봉사자의 작업물이라, 배경 하나 때문에 저장 전체를
 * 거절하지 않는다.
 */
export async function existingBackgroundIds(
  tx: Transaction,
  db: Db,
  ids: readonly (string | null)[],
): Promise<Set<string>> {
  const unique = [
    ...new Set(
      ids.flatMap((id) => (id && !isReservedDocumentId(id) ? [id] : [])),
    ),
  ];
  if (unique.length === 0) return new Set();
  const snapshots = await tx.getAll(
    ...unique.map((id) => backgroundsCol(db).doc(id)),
  );
  return new Set(
    snapshots.filter((snapshot) => snapshot.exists).map((s) => s.id),
  );
}

/** 새 보관함 곡의 기본 필드 (비공개, 가져온 곡 아님) */
export function libraryDeckDefaults(
  id: string,
  userId: string,
): Pick<
  DeckDoc,
  | "id"
  | "userId"
  | "presentationId"
  | "itemId"
  | "position"
  | "forkedFrom"
  | "forkedFromAuthorName"
  | "visibility"
  | "publishedAt"
  | "takedownAt"
  | "forkCount"
> {
  return {
    id,
    userId,
    presentationId: null,
    itemId: null,
    position: null,
    forkedFrom: null,
    forkedFromAuthorName: null,
    visibility: "private",
    publishedAt: null,
    takedownAt: null,
    forkCount: 0,
  };
}

/**
 * 보관함 곡 업서트. 클라이언트가 보낸 곡 내용만 쓴다.
 *
 * 공개 상태·가져온 곡 정보·가져간 횟수는 공개 설정·가져오기 API가 정하는 값이라 이 경로로는
 * 바뀌지 않는다. 남의 곡이거나 프레젠테이션 사본이면 null이다.
 *
 * 본문의 `userId`가 세션 사용자가 아니어도 아무것도 쓰지 않고 null이다. 아직 A라고 믿는 탭이나
 * A가 남긴 대기열이 보낸 곡을 지금 쿠키의 주인인 B의 보관함에 만들면 안 된다.
 */
export async function upsertDeck(
  db: Db,
  userId: string,
  deck: SharedDeck,
): Promise<SharedDeck | null> {
  if (deck.userId !== userId) return null;
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deck.id);
    const existing = (await tx.get(ref)).data();

    if (existing && (existing.userId !== userId || existing.presentationId)) {
      return null;
    }

    const content = toDeckContent(deck);
    const known = await existingBackgroundIds(tx, db, [content.backgroundId]);
    const saved = withDeckIndex({
      ...(existing ?? libraryDeckDefaults(deck.id, userId)),
      ...content,
      backgroundId:
        content.backgroundId && known.has(content.backgroundId)
          ? content.backgroundId
          : null,
    });
    tx.set(ref, saved);
    return toSharedDeck(saved);
  });
}

/**
 * 본인 소유 보관함 곡 삭제.
 *
 * 외래키가 하던 정리를 같은 트랜잭션에서 한다. 이 곡을 가리키던 곡(가져간 곡·담은 사본)의
 * `forkedFrom`과 신고의 `deckId`는 비우고, 이 곡이 가져온 원본의 가져간 횟수는 줄인다.
 */
export async function deleteDeckScoped(
  db: Db,
  deckId: string,
  userId: string,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deckId);
    const deck = (await tx.get(ref)).data();
    if (!deck || deck.userId !== userId || deck.presentationId !== null) {
      return false;
    }

    const [source, dependents, reports] = await Promise.all([
      deck.forkedFrom
        ? tx.get(decksCol(db).doc(deck.forkedFrom))
        : Promise.resolve(null),
      tx.get(decksCol(db).where("forkedFrom", "==", deckId)),
      tx.get(reportsCol(db).where("deckId", "==", deckId)),
    ]);

    tx.delete(ref);
    if (source?.exists) {
      tx.update(source.ref, { forkCount: FieldValue.increment(-1) });
    }
    for (const dependent of dependents.docs) {
      tx.update(dependent.ref, { forkedFrom: null });
    }
    for (const report of reports.docs) {
      tx.update(report.ref, { deckId: null });
    }
    return true;
  });
}
