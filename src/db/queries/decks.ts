import type { Transaction } from "@google-cloud/firestore";
import {
  clampToClock,
  isOutdatedWrite,
  isReservedDocumentId,
  type Deck as SharedDeck,
} from "#shared";
import type { Db } from "../client";
import {
  backgroundsCol,
  decksCol,
  driveTombstonesCol,
  type DeckDoc,
} from "../collections";
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
 * 본인 삭제 기록이 있는 보관함 곡 id. 다른 기기가 부팅 병합에서 지운 곡을 다시 올리지 않게
 * 알리고, 옛 리비전이 다시 만든 곡 문서를 목록에서 가려내는 데 쓴다.
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

/** 새 보관함 곡의 기본 필드 (가져온 곡 아님) */
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
> {
  return {
    id,
    userId,
    presentationId: null,
    itemId: null,
    position: null,
    forkedFrom: null,
    forkedFromAuthorName: null,
  };
}

export type UpsertDeckResult =
  | { status: "saved"; deck: SharedDeck }
  | { status: "forbidden" }
  | { status: "deleted" };

/**
 * 보관함 곡 업서트. 클라이언트가 보낸 곡 내용만 쓴다.
 *
 * 가져온 곡 정보(`forkedFrom`·`forkedFromAuthorName`)는 처음 만든 값을 지키고 이 경로로는 바뀌지
 * 않는다. 남의 곡이거나 프레젠테이션 사본이면 `forbidden`이다.
 *
 * 본문의 `userId`가 세션 사용자가 아니어도 아무것도 쓰지 않고 `forbidden`이다. 아직 A라고 믿는
 * 탭이나 A가 남긴 대기열이 보낸 곡을 지금 쿠키의 주인인 B의 보관함에 만들면 안 된다.
 *
 * 내가 지운 곡(삭제 기록이 있는 id)은 문서가 다시 생겨 있어도 쓰지 않고 `deleted`다. 삭제가
 * 이긴다. 그 곡을 아직 가진 다른 기기와 캐시된 옛 앱은 부팅할 때 서버에 없는 곡을 모두 다시
 * 올리는데, 받아 주면 지운 곡이 원작 표시 없이 되살아나 모든 기기로 퍼진다. 남이 지운 id에 곡을
 * 새로 만드는 저장은 `forbidden`이다. id는 다시 쓰이지 않으므로 정상 저장이 아니고, 받아 주면 그
 * 곡을 지울 때 기록을 남기지 못한다.
 *
 * 시각:
 * - 수정 시각은 서버 시계 + 5분까지로 줄인다(`clampToClock`). 미래 시각으로 저장된 곡은 다른 기기의
 *   새 수정을 모두 옛 수정으로 보고 받지 않는다(`isOutdatedWrite`).
 * - 만든 시각은 처음 저장한 값을 지키고, 처음 저장할 때도 줄인다.
 * - 저장된 곡이 들어온 것보다 늦게 고친 것이면 쓰지 않고 저장된 곡을 돌려준다(`isOutdatedWrite`).
 *   오프라인 대기열이 늦게 올린 옛 수정이 다른 기기의 새 수정을 덮지 않게 한다. 시각이 같으면 쓴다.
 */
export async function upsertDeck(
  db: Db,
  userId: string,
  deck: SharedDeck,
  now: Date = new Date(),
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

    const nowMs = now.getTime();
    const updatedAt = clampToClock(deck.updatedAt, nowMs);
    if (
      existing &&
      isOutdatedWrite(existing.updatedAt.toISOString(), updatedAt, nowMs)
    ) {
      return { status: "saved", deck: toSharedDeck(existing) };
    }

    const content = toDeckContent({
      ...deck,
      createdAt: clampToClock(deck.createdAt, nowMs),
      updatedAt,
    });
    const known = await existingBackgroundIds(tx, db, [content.backgroundId]);
    const saved: DeckDoc = {
      ...(existing ?? libraryDeckDefaults(deck.id, userId)),
      ...content,
      createdAt: existing?.createdAt ?? content.createdAt,
      backgroundId:
        content.backgroundId && known.has(content.backgroundId)
          ? content.backgroundId
          : null,
    };
    tx.set(ref, saved);
    return { status: "saved", deck: toSharedDeck(saved) };
  });
}

/**
 * 본인 소유 보관함 곡 삭제. 지운 id는 삭제 기록(`deckTombstoneDocId`)으로 남겨, 같은 id로 오는
 * 저장을 거절하게 한다(`upsertDeck`).
 *
 * 외래키가 하던 정리를 같은 트랜잭션에서 한다. 이 곡을 가리키던 곡(가져간 곡·담은 사본)의
 * `forkedFrom`은 비운다. 바뀌는 필드만 고친다. 담은 사본은 가사·슬라이드를 통째로 담고 있어, 문서째
 * 다시 쓰면 사본이 많을 때 커밋이 Firestore 한도(10 MiB)를 넘어 이 곡을 지우지 못한다.
 *
 * 멱등이다. 서버에 없는 id도 기록하고 `true`다. 그래서 클라이언트가 시간 초과로 포기한 저장이
 * 삭제보다 늦게 커밋되거나, 다른 탭이 아직 올리지 않은 곡을 올려도 되살아나지 않는다. 기록은
 * 없을 때만 써서 늘어나는 쓰기는 한 건뿐이고, 남의 기록은 덮지 않는다. 남의 곡·프레젠테이션
 * 사본, 서버에 곡이 없는데 남이 기록한 id는 아무것도 쓰지 않고 `false`다.
 *
 * 내 곡 옆에 남의 기록이 있으면 곡은 지우고 `true`지만, 남의 기록을 덮지 않으므로 내 기록은
 * 남지 않는다. 그 id는 `getDeletedDeckIds`에 없어서, 곡을 아직 가진 내 다른 기기가 다시 올리면
 * `deleted`가 아니라 `forbidden`이다. 새 리비전의 저장은 남이 기록한 id에 곡을 만들지 않으므로
 * (`upsertDeck`) 이런 곡은 옛 리비전이 받아 준 저장에서만 생긴다.
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

    const [dependents, tombstone] = await Promise.all([
      tx.get(decksCol(db).where("forkedFrom", "==", deckId)),
      record ? Promise.resolve(null) : prepareRecord(),
    ]);

    tx.delete(ref);
    for (const dependent of dependents.docs) {
      tx.update(dependent.ref, { forkedFrom: null });
    }
    tombstone?.write();
    return true;
  });
}
