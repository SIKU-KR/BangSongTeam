import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  toPresentationChanges,
  type PresentationChanges,
  type PresentationDocument,
} from "#shared";
import {
  presentations,
  decks,
  folders,
  type Presentation,
  type Deck,
  type NewDeck,
} from "../schema";
import { fromPresentationChanges, toPresentationDocument } from "./mappers";
import { chunkIds, runQueries, runStatements } from "./batch";
import { clearTombstoneStatement, tombstoneStatements } from "./folders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/** 프레젠테이션 삭제 */
export async function deletePresentation(
  db: DbInstance,
  presentationId: string,
  userId: string,
): Promise<boolean> {
  const [owned] = await db
    .select({ id: presentations.id })
    .from(presentations)
    .where(
      and(
        eq(presentations.id, presentationId),
        eq(presentations.userId, userId),
      ),
    );

  if (!owned) return false;

  await runStatements(db, [
    db.delete(presentations).where(eq(presentations.id, presentationId)),
    ...tombstoneStatements(db, userId, "presentation", [presentationId]),
  ]);
  return true;
}

/**
 * `savePresentationChanges` 결과.
 *
 * - `forbidden`: 남의 세트, 공유받은 세트(`access`), 또는 다른 곳에 속한 덱 id
 * - `stale`: 항목이 가리키는 덱이 본문에도 서버에도 없다. 클라이언트가 서버 상태를
 *   잘못 알고 있으므로 모든 덱을 담아 다시 보내야 한다.
 */
export type SavePresentationResult = "saved" | "forbidden" | "stale";

interface ExistingCopy {
  id: string;
  itemId: string;
  position: number;
}

interface SentDeckOwner {
  id: string;
  presentationId: string | null;
  userId: string;
}

/**
 * 이미 있는 사본에서 편집기가 바꿀 수 있는 곡 내용 컬럼만 고른다.
 *
 * 나머지(`user_id`·`presentation_id`·`forked_from`·공개 상태)는 사본이 생길 때
 * 정해지거나 서버가 강제하는 값이다. 값이 같아도 SET에 넣으면 SQLite가 그 컬럼의
 * 인덱스를 다시 쓰고 트리거를 돌린다.
 */
function editableDeckColumns(row: NewDeck): Partial<NewDeck> {
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
 * 자리를 고친다. 가사 한 줄을 고친 저장이 곡 수와 상관없이 몇 행만 쓰게 하기 위해서다.
 *
 * D1 왕복은 두 번이다. 소유자·기존 사본·폴더·원본 곡을 한 batch로 읽고, 쓰기는
 * 모두 `db.batch()` 하나로 묶는다. D1에는 대화형 트랜잭션이 없어서 루프로 N번
 * await하면 중간 실패 시 반쪽짜리 문서가 남는다. 두 왕복 사이에 끼어든 쓰기에도
 * 남의 행을 건드리지 않도록 갱신 문장마다 소유자 조건을 다시 건다.
 *
 * 사본의 `forked_from`은 내 곡을 가리킬 때만 남긴다. 아무 곡이나 남기면 저장 뒤
 * 값이 남았는지로 남의 비공개 곡 id가 있는지 알아낼 수 있다. 나머지는 비워서
 * 받는다 — FK 위반으로 batch 전체가 롤백되지 않게.
 *
 * 항목 id(`item_id`)는 전역 유일이다. 남아 있는 사본끼리 항목 id를 맞바꾸면 batch
 * 중간에 유일 제약에 걸리므로, 항목 id가 바뀌는 사본은 먼저 자기 덱 id로 비켜 둔다.
 *
 * 링크로 공유받은 세트(`access`)는 서버에 없어도 새로 만들지 않는다. 소유자가
 * 지운 세트를 받은 사람이 자기 문서로 되살리지 않게 하기 위해서다.
 */
export async function savePresentationChanges(
  db: DbInstance,
  userId: string,
  changes: PresentationChanges,
): Promise<SavePresentationResult> {
  if (changes.access) return "forbidden";

  const sentDeckIdChunks = chunkIds(changes.decks.map((deck) => deck.id));
  const forkedFromIdChunks = chunkIds([
    ...new Set(
      changes.decks.flatMap((deck) =>
        deck.forkedFrom ? [deck.forkedFrom] : [],
      ),
    ),
  ]);
  const [owners, existingCopies, ownedFolders, ...lookups] = (await runQueries(
    db,
    [
      db
        .select({ userId: presentations.userId })
        .from(presentations)
        .where(eq(presentations.id, changes.id)),
      db
        .select({
          id: decks.id,
          itemId: decks.itemId,
          position: decks.position,
        })
        .from(decks)
        .where(eq(decks.presentationId, changes.id)),
      changes.folderId
        ? db
            .select({ id: folders.id })
            .from(folders)
            .where(
              and(eq(folders.id, changes.folderId), eq(folders.userId, userId)),
            )
        : null,
      ...sentDeckIdChunks.map((ids) =>
        db
          .select({
            id: decks.id,
            presentationId: decks.presentationId,
            userId: decks.userId,
          })
          .from(decks)
          .where(inArray(decks.id, ids)),
      ),
      ...forkedFromIdChunks.map((ids) =>
        db
          .select({ id: decks.id })
          .from(decks)
          .where(and(inArray(decks.id, ids), eq(decks.userId, userId))),
      ),
    ],
  )) as [
    { userId: string }[],
    ExistingCopy[],
    { id: string }[],
    ...(SentDeckOwner[] | { id: string }[])[],
  ];
  const sentDeckOwners = lookups
    .slice(0, sentDeckIdChunks.length)
    .flat() as SentDeckOwner[];
  const knownDeckIds = new Set(
    lookups
      .slice(sentDeckIdChunks.length)
      .flatMap((rows) => rows.map((row) => row.id)),
  );

  const [existing] = owners;
  if (existing && existing.userId !== userId) return "forbidden";

  const sentDecksElsewhere = sentDeckOwners.some(
    (deck) => deck.presentationId !== changes.id || deck.userId !== userId,
  );
  if (sentDecksElsewhere) return "forbidden";

  const folderId =
    changes.folderId === undefined
      ? undefined
      : changes.folderId !== null && ownedFolders.length > 0
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

  const previous = new Map(existingCopies.map((copy) => [copy.id, copy]));
  const sent = new Map(sentDeckRows.map((row) => [row.id as string, row]));
  const missingDeck = slots.some(
    (slot) => !sent.has(slot.deckId) && !previous.has(slot.deckId),
  );
  if (missingDeck) return "stale";

  const nextDeckIds = new Set(slots.map((slot) => slot.deckId));
  const removedDeckIds = existingCopies
    .map((copy) => copy.id)
    .filter((id) => !nextDeckIds.has(id));
  const removed = new Set(removedDeckIds);

  const ownedCopy = (deckId: string) =>
    and(
      eq(decks.id, deckId),
      eq(decks.presentationId, changes.id),
      eq(decks.userId, userId),
    );

  const statements: unknown[] = [
    clearTombstoneStatement(db, userId, changes.id),
  ];

  if (existing) {
    statements.push(
      db
        .update(presentations)
        .set({
          title: presentation.title,
          serviceDate: presentation.serviceDate,
          updatedAt: presentation.updatedAt,
          ...(presentation.folderId === undefined
            ? {}
            : { folderId: presentation.folderId }),
          ...(presentation.trashedAt === undefined
            ? {}
            : { trashedAt: presentation.trashedAt }),
        })
        .where(
          and(
            eq(presentations.id, changes.id),
            eq(presentations.userId, userId),
          ),
        ),
    );
  } else {
    statements.push(db.insert(presentations).values(presentation));
  }

  for (const ids of chunkIds(removedDeckIds)) {
    statements.push(
      db
        .delete(decks)
        .where(
          and(eq(decks.presentationId, changes.id), inArray(decks.id, ids)),
        ),
    );
  }

  const moved = slots.filter((slot) => {
    const copy = previous.get(slot.deckId);
    return copy !== undefined && copy.itemId !== slot.itemId;
  });
  for (const slot of moved) {
    statements.push(
      db
        .update(decks)
        .set({ itemId: slot.deckId })
        .where(ownedCopy(slot.deckId)),
    );
  }

  for (const slot of slots) {
    const copy = previous.get(slot.deckId);
    const row = sent.get(slot.deckId);
    if (copy) {
      const changed = {
        ...(row ? editableDeckColumns(row) : {}),
        ...(copy.itemId === slot.itemId ? {} : { itemId: slot.itemId }),
        ...(copy.position === slot.position ? {} : { position: slot.position }),
      };
      if (Object.keys(changed).length > 0) {
        statements.push(
          db.update(decks).set(changed).where(ownedCopy(slot.deckId)),
        );
      }
    } else if (row) {
      const forkedFrom =
        row.forkedFrom &&
        knownDeckIds.has(row.forkedFrom) &&
        !removed.has(row.forkedFrom)
          ? row.forkedFrom
          : null;
      statements.push(db.insert(decks).values({ ...row, forkedFrom }));
    }
  }

  await runStatements(db, statements);
  return "saved";
}

/**
 * 프레젠테이션 문서 업서트 (문서 단위 전체 교체). 모든 덱을 담은 변경분 저장과 같다.
 * 소유자가 다르거나 공유받은 세트면 아무것도 쓰지 않고 false를 돌린다.
 */
export async function upsertPresentationDocument(
  db: DbInstance,
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
  db: DbInstance,
  userId: string,
): Promise<PresentationDocument[]> {
  const headers = await db
    .select()
    .from(presentations)
    .where(eq(presentations.userId, userId))
    .orderBy(desc(presentations.serviceDate), desc(presentations.createdAt));

  return hydratePresentationDocuments(db, headers);
}

/** 헤더 행에 사본 덱을 붙여 문서로 만든다. 권한 검사는 호출자 책임이다. */
export async function hydratePresentationDocuments(
  db: DbInstance,
  headers: Presentation[],
): Promise<PresentationDocument[]> {
  if (headers.length === 0) return [];

  const copies: Deck[] = [];
  for (const ids of chunkIds(headers.map((h) => h.id))) {
    copies.push(
      ...(await db
        .select()
        .from(decks)
        .where(inArray(decks.presentationId, ids))
        .orderBy(asc(decks.position))),
    );
  }

  const byPresentation = new Map<string, Deck[]>();
  for (const copy of copies) {
    const id = copy.presentationId as string;
    const list = byPresentation.get(id) ?? [];
    list.push(copy);
    byPresentation.set(id, list);
  }

  return headers.map((header) =>
    toPresentationDocument(header, byPresentation.get(header.id) ?? []),
  );
}
