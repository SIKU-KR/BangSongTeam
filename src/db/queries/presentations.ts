import {
  toPresentationChanges,
  type PresentationChanges,
  type PresentationDocument,
} from "#shared";
import type { Db } from "../client";
import {
  chunkIds,
  decksCol,
  foldersCol,
  presentationsCol,
  type DeckDoc,
  type PresentationDoc,
} from "../collections";
import { fromPresentationChanges, toPresentationDocument } from "./mappers";
import { existingBackgroundIds } from "./decks";
import {
  prepareClearTombstone,
  readPresentationDependents,
  writeTombstones,
} from "./cascade";

/** 예배 날짜 최신순, 같으면 만든 순서 최신순 */
export function byServiceDateDesc(
  a: PresentationDoc,
  b: PresentationDoc,
): number {
  if (a.serviceDate !== b.serviceDate) {
    return a.serviceDate < b.serviceDate ? 1 : -1;
  }
  return b.createdAt.getTime() - a.createdAt.getTime();
}

/** 프레젠테이션 삭제. 담긴 사본 곡과 공유 멤버도 함께 지운다 */
export async function deletePresentation(
  db: Db,
  presentationId: string,
  userId: string,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = presentationsCol(db).doc(presentationId);
    const [presentation, dependents] = await Promise.all([
      tx.get(ref),
      readPresentationDependents(tx, db, [presentationId]),
    ]);
    if (presentation.data()?.userId !== userId) return false;

    for (const dependent of dependents) tx.delete(dependent);
    tx.delete(ref);
    writeTombstones(tx, db, userId, "presentation", [presentationId]);
    return true;
  });
}

/**
 * `savePresentationChanges` 결과.
 *
 * - `forbidden`: 남의 세트, 공유받은 세트(`access`), 또는 다른 곳에 속한 덱 id
 * - `stale`: 항목이 가리키는 덱이 본문에도 서버에도 없다. 클라이언트가 서버 상태를
 *   잘못 알고 있으므로 모든 덱을 담아 다시 보내야 한다.
 */
export type SavePresentationResult = "saved" | "forbidden" | "stale";

/**
 * 이미 있는 사본에서 편집기가 바꿀 수 있는 곡 내용 필드만 고른다.
 *
 * 나머지(`userId`·`presentationId`·`forkedFrom`·공개 상태)는 사본이 생길 때 정해지거나
 * 서버가 강제하는 값이다.
 */
function editableDeckFields(row: DeckDoc): Partial<DeckDoc> {
  return {
    title: row.title,
    artist: row.artist,
    lyricsRaw: row.lyricsRaw,
    slides: row.slides,
    backgroundId: row.backgroundId,
    style: row.style,
    forkedFromAuthorName: row.forkedFromAuthorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 프레젠테이션 변경분 저장.
 *
 * 결과는 문서 단위 전체 교체와 같다. 항목에 없는 사본은 지우고(삭제한 곡이 다음
 * 조회에서 되살아나지 않게), 본문에 담긴 사본만 내용을 쓰고, 자리가 바뀐 사본만
 * 자리를 고친다. 가사 한 줄을 고친 저장이 곡 수와 상관없이 몇 문서만 쓰게 하기 위해서다.
 *
 * 읽기와 쓰기를 한 트랜잭션으로 묶는다. 중간에 실패하면 아무것도 쓰지 않아 반쪽짜리
 * 문서가 남지 않고, 그사이 끼어든 쓰기가 있으면 Firestore가 다시 시도한다.
 *
 * 사본의 `forkedFrom`은 내 곡을 가리킬 때만 남긴다. 아무 곡이나 남기면 저장 뒤 값이
 * 남았는지로 남의 비공개 곡 id가 있는지 알아낼 수 있다. 서버에 없는 배경은 비운다.
 *
 * 링크로 공유받은 세트(`access`)는 서버에 없어도 새로 만들지 않는다. 소유자가
 * 지운 세트를 받은 사람이 자기 문서로 되살리지 않게 하기 위해서다.
 */
export async function savePresentationChanges(
  db: Db,
  userId: string,
  changes: PresentationChanges,
): Promise<SavePresentationResult> {
  if (changes.access) return "forbidden";

  const sentDeckIds = changes.decks.map((deck) => deck.id);
  const forkedFromIds = [
    ...new Set(
      changes.decks.flatMap((deck) =>
        deck.forkedFrom ? [deck.forkedFrom] : [],
      ),
    ),
  ];
  const ref = presentationsCol(db).doc(changes.id);

  return db.runTransaction(async (tx) => {
    const [
      existingSnapshot,
      copiesSnapshot,
      folderSnapshot,
      sentDecks,
      forkedFromDecks,
      knownBackgrounds,
      clearTombstone,
    ] = await Promise.all([
      tx.get(ref),
      tx.get(decksCol(db).where("presentationId", "==", changes.id)),
      changes.folderId
        ? tx.get(foldersCol(db).doc(changes.folderId))
        : Promise.resolve(null),
      sentDeckIds.length > 0
        ? tx.getAll(...sentDeckIds.map((id) => decksCol(db).doc(id)))
        : Promise.resolve([]),
      forkedFromIds.length > 0
        ? tx.getAll(...forkedFromIds.map((id) => decksCol(db).doc(id)))
        : Promise.resolve([]),
      existingBackgroundIds(
        tx,
        db,
        changes.decks.map((deck) => deck.backgroundId),
      ),
      prepareClearTombstone(tx, db, userId, changes.id),
    ]);

    const existing = existingSnapshot.data();
    if (existing && existing.userId !== userId) return "forbidden";

    const sentDecksElsewhere = sentDecks.some((snapshot) => {
      const deck = snapshot.data();
      return (
        deck !== undefined &&
        (deck.presentationId !== changes.id || deck.userId !== userId)
      );
    });
    if (sentDecksElsewhere) return "forbidden";

    const ownedFolder = folderSnapshot?.data()?.userId === userId;
    const folderId =
      changes.folderId === undefined
        ? undefined
        : changes.folderId !== null && ownedFolder
          ? changes.folderId
          : null;

    const {
      presentation,
      slots,
      decks: sentDeckRows,
    } = fromPresentationChanges({
      ...changes,
      userId,
      ...(folderId === undefined ? {} : { folderId }),
    });

    const existingCopies = copiesSnapshot.docs.map((doc) => doc.data());
    const previous = new Map(existingCopies.map((copy) => [copy.id, copy]));
    const sent = new Map(
      sentDeckRows.map((row) => [
        row.id,
        {
          ...row,
          backgroundId:
            row.backgroundId && knownBackgrounds.has(row.backgroundId)
              ? row.backgroundId
              : null,
        },
      ]),
    );
    const missingDeck = slots.some(
      (slot) => !sent.has(slot.deckId) && !previous.has(slot.deckId),
    );
    if (missingDeck) return "stale";

    const nextDeckIds = new Set(slots.map((slot) => slot.deckId));
    const removed = new Set(
      existingCopies
        .map((copy) => copy.id)
        .filter((id) => !nextDeckIds.has(id)),
    );
    const myDeckIds = new Set(
      forkedFromDecks
        .filter((snapshot) => snapshot.data()?.userId === userId)
        .map((snapshot) => snapshot.id),
    );

    clearTombstone();

    if (existing) {
      tx.update(ref, {
        title: presentation.title,
        serviceDate: presentation.serviceDate,
        updatedAt: presentation.updatedAt,
        ...(presentation.folderId === undefined
          ? {}
          : { folderId: presentation.folderId }),
        ...(presentation.trashedAt === undefined
          ? {}
          : { trashedAt: presentation.trashedAt }),
      });
    } else {
      tx.set(ref, {
        ...presentation,
        folderId: presentation.folderId ?? null,
        trashedAt: presentation.trashedAt ?? null,
        linkAccess: "off",
        linkToken: null,
      });
    }

    for (const id of removed) tx.delete(decksCol(db).doc(id));

    for (const slot of slots) {
      const copy = previous.get(slot.deckId);
      const row = sent.get(slot.deckId);
      if (copy) {
        const changed = {
          ...(row ? editableDeckFields(row) : {}),
          ...(copy.itemId === slot.itemId ? {} : { itemId: slot.itemId }),
          ...(copy.position === slot.position
            ? {}
            : { position: slot.position }),
        };
        if (Object.keys(changed).length > 0) {
          tx.update(decksCol(db).doc(slot.deckId), changed);
        }
      } else if (row) {
        const forkedFrom =
          row.forkedFrom &&
          myDeckIds.has(row.forkedFrom) &&
          !removed.has(row.forkedFrom)
            ? row.forkedFrom
            : null;
        tx.set(decksCol(db).doc(row.id), { ...row, forkedFrom });
      }
    }

    return "saved";
  });
}

/**
 * 프레젠테이션 문서 업서트 (문서 단위 전체 교체). 모든 덱을 담은 변경분 저장과 같다.
 * 소유자가 다르거나 공유받은 세트면 아무것도 쓰지 않고 false를 돌린다.
 */
export async function upsertPresentationDocument(
  db: Db,
  userId: string,
  doc: PresentationDocument,
): Promise<boolean> {
  return (
    (await savePresentationChanges(db, userId, toPresentationChanges(doc))) ===
    "saved"
  );
}

/** 본인 소유 프레젠테이션 전체를 하이드레이션된 문서 목록으로 조회 */
export async function getPresentationDocumentsByUserId(
  db: Db,
  userId: string,
): Promise<PresentationDocument[]> {
  const snapshot = await presentationsCol(db)
    .where("userId", "==", userId)
    .get();
  const headers = snapshot.docs
    .map((doc) => doc.data())
    .sort(byServiceDateDesc);

  return hydratePresentationDocuments(db, headers);
}

/** 헤더에 사본 곡을 붙여 문서로 만든다. 권한 검사는 호출자 책임이다. */
export async function hydratePresentationDocuments(
  db: Db,
  headers: PresentationDoc[],
): Promise<PresentationDocument[]> {
  if (headers.length === 0) return [];

  const snapshots = await Promise.all(
    chunkIds(headers.map((h) => h.id)).map((ids) =>
      decksCol(db).where("presentationId", "in", ids).get(),
    ),
  );

  const byPresentation = new Map<string, DeckDoc[]>();
  for (const copy of snapshots.flatMap((s) => s.docs.map((d) => d.data()))) {
    const id = copy.presentationId as string;
    const list = byPresentation.get(id) ?? [];
    list.push(copy);
    byPresentation.set(id, list);
  }

  return headers.map((header) =>
    toPresentationDocument(
      header,
      (byPresentation.get(header.id) ?? []).sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      ),
    ),
  );
}
