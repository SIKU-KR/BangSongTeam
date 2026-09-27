import { eq, and, asc, desc, inArray } from "drizzle-orm";
import {
  createId,
  toPresentationChanges,
  type PresentationChanges,
  type PresentationDocument,
} from "#shared";
import {
  presentations,
  presentationItems,
  decks,
  folders,
  type Presentation,
  type Deck,
  type NewDeck,
} from "../schema";
import { fromPresentationChanges, toPresentationDocument } from "./mappers";
import { keepKnownBackgrounds, knownBackgroundsQuery } from "./backgrounds";
import { chunkIds, runQueries, runStatements } from "./batch";
import { clearTombstoneStatement, tombstoneStatements } from "./folders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export interface HydratedPresentationItem {
  id: string;
  presentationId: string;
  deckId: string;
  order: number;
  deck: Deck;
}

export interface PresentationWithDecks extends Presentation {
  items: HydratedPresentationItem[];
}

/** 프레젠테이션 및 속한 덱 목록 조회 (사용자 소유 검증) */
export async function getPresentationWithDecks(
  db: DbInstance,
  presentationId: string,
  userId: string,
): Promise<PresentationWithDecks | null> {
  const [presentation] = await db
    .select()
    .from(presentations)
    .where(
      and(
        eq(presentations.id, presentationId),
        eq(presentations.userId, userId),
      ),
    );

  if (!presentation) return null;

  const rows = await db
    .select({
      item: presentationItems,
      deck: decks,
    })
    .from(presentationItems)
    .innerJoin(decks, eq(presentationItems.deckId, decks.id))
    .where(eq(presentationItems.presentationId, presentationId))
    .orderBy(asc(presentationItems.order));

  return {
    ...presentation,
    items: rows.map(
      (r: { item: typeof presentationItems.$inferSelect; deck: Deck }) => ({
        id: r.item.id,
        presentationId: r.item.presentationId,
        deckId: r.item.deckId,
        order: r.item.order,
        deck: r.deck,
      }),
    ),
  };
}

/** 사용자 소유 프레젠테이션 목록 조회 */
export async function getPresentationsByUserId(
  db: DbInstance,
  userId: string,
): Promise<Presentation[]> {
  return db
    .select()
    .from(presentations)
    .where(eq(presentations.userId, userId))
    .orderBy(desc(presentations.serviceDate), desc(presentations.createdAt));
}

/** 원본 덱을 복제하여 프레젠테이션 생성 */
export async function createPresentationWithClonedDecks(
  db: DbInstance,
  params: {
    userId: string;
    title: string;
    serviceDate: string;
    sourceDeckIds: string[];
  },
): Promise<PresentationWithDecks> {
  const presentationId = createId();

  await db.insert(presentations).values({
    id: presentationId,
    userId: params.userId,
    title: params.title,
    serviceDate: params.serviceDate,
  });

  const clonedItems: HydratedPresentationItem[] = [];

  for (let order = 0; order < params.sourceDeckIds.length; order++) {
    const sourceId = params.sourceDeckIds[order];
    const [sourceDeck] = await db
      .select()
      .from(decks)
      .where(eq(decks.id, sourceId));

    const canClone =
      sourceDeck &&
      (sourceDeck.userId === params.userId ||
        sourceDeck.visibility === "public");

    if (!canClone) {
      throw new Error(`Source deck with id '${sourceId}' not found.`);
    }

    const clonedDeckId = createId();
    const clonedDeckValues = {
      id: clonedDeckId,
      userId: params.userId,
      scope: "presentation" as const,
      presentationId: presentationId,
      title: sourceDeck.title,
      artist: sourceDeck.artist,
      lyricsRaw: sourceDeck.lyricsRaw,
      slides: sourceDeck.slides,
      backgroundId: sourceDeck.backgroundId,
      style: sourceDeck.style,
      visibility: "private" as const,
      forkedFrom: sourceDeck.id,
      forkCount: 0,
    };

    await db.insert(decks).values(clonedDeckValues);

    const itemId = createId();
    await db.insert(presentationItems).values({
      id: itemId,
      presentationId: presentationId,
      deckId: clonedDeckId,
      order,
    });

    const [createdClonedDeck] = await db
      .select()
      .from(decks)
      .where(eq(decks.id, clonedDeckId));

    clonedItems.push({
      id: itemId,
      presentationId,
      deckId: clonedDeckId,
      order,
      deck: createdClonedDeck,
    });
  }

  const [createdPresentation] = await db
    .select()
    .from(presentations)
    .where(eq(presentations.id, presentationId));

  return {
    ...createdPresentation,
    items: clonedItems,
  };
}

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

interface ExistingItem {
  id: string;
  deckId: string;
  order: number;
}

interface ExistingDeck {
  id: string;
  presentationId: string | null;
  userId: string;
}

/**
 * 이미 있는 세트 덱에서 편집기가 바꿀 수 있는 컬럼만 고른다.
 *
 * 나머지(`user_id`·`scope`·`presentation_id`·`visibility`·`fork_count`·
 * `forked_from`)는 덱이 생길 때 정해지거나 서버가 강제하는 값이다. 값이 같아도
 * SET에 넣으면 SQLite가 그 컬럼의 인덱스를 다시 써서 곡 하나에 5행이 쓰인다.
 */
function editableDeckColumns(row: NewDeck): Partial<NewDeck> {
  return {
    title: row.title,
    artist: row.artist,
    lyricsRaw: row.lyricsRaw,
    slides: row.slides,
    backgroundId: row.backgroundId,
    style: row.style,
    origin: row.origin,
    forkedFromAuthorName: row.forkedFromAuthorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 프레젠테이션 변경분 저장.
 *
 * 결과는 문서 단위 전체 교체와 같다. `items`에 없는 항목과 곡은 지우고(삭제한 곡이
 * 다음 조회에서 되살아나지 않게), 본문에 담긴 덱만 쓰고, 순서가 바뀐 항목만
 * 고친다. 가사 한 줄을 고친 저장이 곡 수와 상관없이 몇 행만 쓰게 하기 위해서다.
 *
 * D1 왕복은 두 번이다. 소유자·기존 항목과 덱·폴더·배경을 한 batch로 읽고, 쓰기는
 * 모두 `db.batch()` 하나로 묶는다. D1에는 대화형 트랜잭션이 없어서 루프로 N번
 * await하면 중간 실패 시 반쪽짜리 문서가 남는다. 두 왕복 사이에 끼어든 쓰기에도
 * 남의 행을 건드리지 않도록 갱신 문장마다 소유자 조건을 다시 건다.
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
  const [
    owners,
    existingItems,
    existingDecks,
    ownedFolders,
    knownBackgrounds,
    ...sentDeckChunks
  ] = (await runQueries(db, [
    db
      .select({ userId: presentations.userId })
      .from(presentations)
      .where(eq(presentations.id, changes.id)),
    db
      .select({
        id: presentationItems.id,
        deckId: presentationItems.deckId,
        order: presentationItems.order,
      })
      .from(presentationItems)
      .where(eq(presentationItems.presentationId, changes.id)),
    db
      .select({ id: decks.id })
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
    knownBackgroundsQuery(db, changes.decks),
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
  ])) as [
    { userId: string }[],
    ExistingItem[],
    { id: string }[],
    { id: string }[],
    { id: string }[],
    ...ExistingDeck[][],
  ];

  const [existing] = owners;
  if (existing && existing.userId !== userId) return "forbidden";

  const sentDecksElsewhere = sentDeckChunks
    .flat()
    .some(
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
    items,
    decks: sentDeckRows,
  } = fromPresentationChanges({
    ...changes,
    userId,
    ...(folderId === undefined ? {} : { folderId }),
  });

  const existingDeckIds = new Set(existingDecks.map((deck) => deck.id));
  const nextDeckIds = new Set(items.map((item) => item.deckId));
  const sentDeckIds = new Set(sentDeckRows.map((deck) => deck.id));
  const missingDeck = [...nextDeckIds].some(
    (deckId) => !sentDeckIds.has(deckId) && !existingDeckIds.has(deckId),
  );
  if (missingDeck) return "stale";

  const deckRows = keepKnownBackgrounds(
    sentDeckRows.filter((deck) => nextDeckIds.has(deck.id as string)),
    knownBackgrounds,
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

  const previousItems = new Map(existingItems.map((item) => [item.id, item]));
  const nextItems = new Map(items.map((item) => [item.id, item]));
  const removedItemIds = existingItems
    .filter((item) => nextItems.get(item.id)?.deckId !== item.deckId)
    .map((item) => item.id);
  for (const ids of chunkIds(removedItemIds)) {
    statements.push(
      db
        .delete(presentationItems)
        .where(
          and(
            eq(presentationItems.presentationId, changes.id),
            inArray(presentationItems.id, ids),
          ),
        ),
    );
  }

  const removedDeckIds = [...existingDeckIds].filter(
    (id) => !nextDeckIds.has(id),
  );
  for (const ids of chunkIds(removedDeckIds)) {
    statements.push(
      db
        .delete(decks)
        .where(
          and(eq(decks.presentationId, changes.id), inArray(decks.id, ids)),
        ),
    );
  }

  for (const deckRow of deckRows) {
    if (existingDeckIds.has(deckRow.id as string)) {
      statements.push(
        db
          .update(decks)
          .set(editableDeckColumns(deckRow))
          .where(
            and(
              eq(decks.id, deckRow.id as string),
              eq(decks.presentationId, changes.id),
              eq(decks.userId, userId),
            ),
          ),
      );
    } else {
      statements.push(db.insert(decks).values(deckRow));
    }
  }

  for (const item of items) {
    const previous = previousItems.get(item.id);
    if (previous?.deckId !== item.deckId) {
      statements.push(db.insert(presentationItems).values(item));
    } else if (previous.order !== item.order) {
      statements.push(
        db
          .update(presentationItems)
          .set({ order: item.order })
          .where(
            and(
              eq(presentationItems.id, item.id),
              eq(presentationItems.presentationId, changes.id),
            ),
          ),
      );
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

/** 프레젠테이션 헤더(제목·예배일) 수정 */
export async function updatePresentation(
  db: DbInstance,
  presentationId: string,
  userId: string,
  patch: { title?: string; serviceDate?: string },
): Promise<boolean> {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.serviceDate !== undefined) values.serviceDate = patch.serviceDate;

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

  await db
    .update(presentations)
    .set(values)
    .where(eq(presentations.id, presentationId));

  return true;
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

/** 헤더 행에 항목·덱을 붙여 문서로 만든다. 권한 검사는 호출자 책임이다. */
export async function hydratePresentationDocuments(
  db: DbInstance,
  headers: Presentation[],
): Promise<PresentationDocument[]> {
  if (headers.length === 0) return [];

  const rows: Array<{
    item: typeof presentationItems.$inferSelect;
    deck: Deck;
  }> = [];
  for (const ids of chunkIds(headers.map((h) => h.id))) {
    rows.push(
      ...(await db
        .select({ item: presentationItems, deck: decks })
        .from(presentationItems)
        .innerJoin(decks, eq(presentationItems.deckId, decks.id))
        .where(inArray(presentationItems.presentationId, ids))
        .orderBy(asc(presentationItems.order))),
    );
  }

  const byPresentation = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byPresentation.get(row.item.presentationId) ?? [];
    list.push(row);
    byPresentation.set(row.item.presentationId, list);
  }

  return headers.map((header) =>
    toPresentationDocument(header, byPresentation.get(header.id) ?? []),
  );
}

export function createPresentationQueries(db: DbInstance) {
  return {
    getPresentationWithDecks: (presentationId: string, userId: string) =>
      getPresentationWithDecks(db, presentationId, userId),
    getPresentationsByUserId: (userId: string) =>
      getPresentationsByUserId(db, userId),
    createPresentationWithClonedDecks: (
      params: Parameters<typeof createPresentationWithClonedDecks>[1],
    ) => createPresentationWithClonedDecks(db, params),
    deletePresentation: (presentationId: string, userId: string) =>
      deletePresentation(db, presentationId, userId),
    upsertPresentationDocument: (userId: string, doc: PresentationDocument) =>
      upsertPresentationDocument(db, userId, doc),
    savePresentationChanges: (userId: string, changes: PresentationChanges) =>
      savePresentationChanges(db, userId, changes),
    updatePresentation: (
      presentationId: string,
      userId: string,
      patch: { title?: string; serviceDate?: string },
    ) => updatePresentation(db, presentationId, userId, patch),
    getPresentationDocumentsByUserId: (userId: string) =>
      getPresentationDocumentsByUserId(db, userId),
  };
}

export const presentationQueries = {
  getPresentationWithDecks,
  getPresentationsByUserId,
  createPresentationWithClonedDecks,
  deletePresentation,
  upsertPresentationDocument,
  savePresentationChanges,
  updatePresentation,
  getPresentationDocumentsByUserId,
  createPresentationQueries,
};
