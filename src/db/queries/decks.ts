import { FieldValue, type Transaction } from "@google-cloud/firestore";
import { isReservedDocumentId, type Deck as SharedDeck } from "#shared";
import type { Db } from "../client";
import {
  backgroundsCol,
  decksCol,
  driveTombstonesCol,
  reportsCol,
  type DeckDoc,
} from "../collections";
import { withDeckIndex } from "../deckIndex";
import { prepareTombstones, readTombstone } from "./cascade";
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
 * 본인이 지운 보관함 곡 id. 다른 기기가 부팅 병합에서 지운 곡을 다시 올리지 않게 알리고, 옛
 * 리비전이 다시 만든 곡 문서를 목록에서 가려내는 데 쓴다.
 *
 * 드라이브 기록(`getDriveTombstones`)과 같은 단일 필드(`userId`) 조회에 종류는 메모리에서 거르므로
 * 복합 색인이 필요 없다.
 */
export async function getDeletedDeckIds(
  db: Db,
  userId: string,
): Promise<string[]> {
  const snapshot = await driveTombstonesCol(db)
    .where("userId", "==", userId)
    .get();
  return snapshot.docs.flatMap((doc) => {
    const record = doc.data();
    return record.kind === "deck" ? [record.itemId] : [];
  });
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

export type UpsertDeckResult =
  | { status: "saved"; deck: SharedDeck }
  | { status: "forbidden" }
  | { status: "deleted" };

/**
 * 보관함 곡 업서트. 클라이언트가 보낸 곡 내용만 쓴다.
 *
 * 공개 상태·가져온 곡 정보·가져간 횟수는 공개 설정·가져오기 API가 정하는 값이라 이 경로로는
 * 바뀌지 않는다. 남의 곡이거나 프레젠테이션 사본이면 `forbidden`이다.
 *
 * 본문의 `userId`가 세션 사용자가 아니어도 아무것도 쓰지 않고 `forbidden`이다. 아직 A라고 믿는
 * 탭이나 A가 남긴 대기열이 보낸 곡을 지금 쿠키의 주인인 B의 보관함에 만들면 안 된다.
 *
 * 내가 지운 곡(삭제 기록이 있는 id)은 문서가 다시 생겨 있어도 쓰지 않고 `deleted`다. 삭제가
 * 이긴다. 그 곡을 아직 가진 다른 기기와 캐시된 옛 앱은 부팅할 때 서버에 없는 곡을 모두 다시
 * 올리는데, 받아 주면 지운 곡이 원작 표시 없이 비공개로 되살아나 모든 기기로 퍼진다. 남이 지운
 * id에 곡을 새로 만드는 저장은 `forbidden`이다. id는 다시 쓰이지 않으므로(가져오기는 새 id를
 * 만든다) 정상 저장이 아니고, 받아 주면 그 곡을 지울 때 기록을 남기지 못한다.
 */
export async function upsertDeck(
  db: Db,
  userId: string,
  deck: SharedDeck,
): Promise<UpsertDeckResult> {
  if (deck.userId !== userId) return { status: "forbidden" };
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deck.id);
    const [existing, record] = await Promise.all([
      tx.get(ref).then((snapshot) => snapshot.data()),
      readTombstone(tx, db, "deck", deck.id),
    ]);

    if (record?.userId === userId) return { status: "deleted" };
    if (!existing && record) return { status: "forbidden" };
    if (existing && (existing.userId !== userId || existing.presentationId)) {
      return { status: "forbidden" };
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
    return { status: "saved", deck: toSharedDeck(saved) };
  });
}

/**
 * 본인 소유 보관함 곡 삭제. 지운 id는 삭제 기록(`deckTombstoneDocId`)으로 남겨, 같은 id로 오는
 * 저장과 공개 설정을 거절하게 한다(`upsertDeck`, `setDeckVisibility`).
 *
 * 외래키가 하던 정리를 같은 트랜잭션에서 한다. 이 곡을 가리키던 곡(가져간 곡·담은 사본)의
 * `forkedFrom`과 신고의 `deckId`는 비우고, 이 곡이 가져온 원본의 가져간 횟수는 줄인다.
 *
 * 멱등이다. 서버에 없는 id도 기록하고 `true`다. 그래서 클라이언트가 시간 초과로 포기한 저장이
 * 삭제보다 늦게 커밋되거나, 다른 탭이 아직 올리지 않은 곡을 올려도 되살아나지 않는다. 기록은
 * 없을 때만 써서 늘어나는 쓰기는 한 건뿐이고, 남의 기록은 덮지 않는다. 남의 곡·프레젠테이션
 * 사본·남이 기록한 id는 아무것도 쓰지 않고 `false`다.
 */
export async function deleteDeckScoped(
  db: Db,
  deckId: string,
  userId: string,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deckId);
    const [deck, record] = await Promise.all([
      tx.get(ref).then((snapshot) => snapshot.data()),
      readTombstone(tx, db, "deck", deckId),
    ]);
    const prepareRecord = () =>
      prepareTombstones(tx, db, userId, [{ kind: "deck", itemId: deckId }]);

    if (!deck) {
      if (record) return record.userId === userId;
      (await prepareRecord()).write();
      return true;
    }
    if (deck.userId !== userId || deck.presentationId !== null) return false;

    const [source, dependents, reports, tombstone] = await Promise.all([
      deck.forkedFrom
        ? tx.get(decksCol(db).doc(deck.forkedFrom))
        : Promise.resolve(null),
      tx.get(decksCol(db).where("forkedFrom", "==", deckId)),
      tx.get(reportsCol(db).where("deckId", "==", deckId)),
      record ? Promise.resolve(null) : prepareRecord(),
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
    tombstone?.write();
    return true;
  });
}
