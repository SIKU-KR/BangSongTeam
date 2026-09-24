import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { createId, type PresentationDocument } from "@repo/shared";
import {
  presentations,
  presentationItems,
  decks,
  type Presentation,
  type Deck,
} from "../schema";
import { fromPresentationDocument, toPresentationDocument } from "./mappers";
import { nullifyUnknownBackgrounds } from "./backgrounds";
import { runStatements } from "./batch";
import {
  clearTombstone,
  resolveOwnedFolderId,
  tombstoneStatements,
} from "./folders";

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

/**
 * 1. 프레젠테이션(Presentation) 및 속한 덱 목록 원자적 조회
 * RLS 부재 대응: presentation.userId 일치 여부를 필수 검증
 */
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

/**
 * 2. 사용자 소유 프레젠테이션 목록 조회
 */
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

/**
 * 3. Clone-on-Add 프레젠테이션 생성 헬퍼
 * 원본 덱을 복제하여 `scope = 'presentation'`, `presentationId = presentation.id`, `forkedFrom = 원본ID`로 격리 저장
 */
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

  // 1. 프레젠테이션 헤더 삽입
  await db.insert(presentations).values({
    id: presentationId,
    userId: params.userId,
    title: params.title,
    serviceDate: params.serviceDate,
  });

  const clonedItems: HydratedPresentationItem[] = [];

  // 2. 원본 덱들을 로드하여 Clone-on-Add 복제본 생성
  for (let order = 0; order < params.sourceDeckIds.length; order++) {
    const sourceId = params.sourceDeckIds[order];
    const [sourceDeck] = await db
      .select()
      .from(decks)
      .where(eq(decks.id, sourceId));

    // 소유자이거나 공개된 덱만 복제한다. id만 알면 남의 비공개 덱을
    // 복제할 수 있었던 경로를 막는다 (D1에는 RLS가 없다).
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
      visibility: "private" as const, // 프레젠테이션 복제본은 무조건 비공개
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

/**
 * 4. 프레젠테이션 삭제 헬퍼 (ON DELETE CASCADE로 종속 복제 덱 및 아이템 자동 정리)
 */
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

  // 다른 기기의 부팅 병합이 되살리지 않도록 영구 삭제 기록을 함께 남긴다.
  await runStatements(db, [
    db.delete(presentations).where(eq(presentations.id, presentationId)),
    ...tombstoneStatements(db, userId, "presentation", [presentationId]),
  ]);
  return true;
}

/**
 * 프레젠테이션 문서 업서트 (문서 단위 전체 교체).
 *
 * 로컬 IndexedDB가 문서 1건을 통째로 put하는 것과 같은 의미를 서버에서도
 * 보장한다. 항목과 덱은 지우고 다시 넣는다. 부분 갱신을 시도하면 삭제된 곡이
 * 서버에 남아 다음 조회에서 되살아난다.
 *
 * D1에는 대화형 트랜잭션이 없으므로 `db.batch()`로 묶는다. 루프로 N번 await하면
 * 중간 실패 시 반쪽짜리 문서가 남는다.
 *
 * 소유자가 다르면 아무것도 쓰지 않고 false를 돌린다.
 */
export async function upsertPresentationDocument(
  db: DbInstance,
  userId: string,
  doc: PresentationDocument,
): Promise<boolean> {
  const [existing] = await db
    .select({ userId: presentations.userId })
    .from(presentations)
    .where(eq(presentations.id, doc.id));

  if (existing && existing.userId !== userId) return false;

  // 드라이브 배치: 필드가 아예 없으면(구버전 클라이언트) 기존 값을 건드리지 않는다.
  // 남의 폴더나 사라진 폴더를 가리키면 루트로 보정한다 — 문서를 거절하면
  // 그 기기의 세트가 영영 올라가지 않는다.
  const folderId =
    doc.folderId === undefined
      ? undefined
      : await resolveOwnedFolderId(db, userId, doc.folderId);

  const {
    presentation,
    items,
    decks: rawDeckRows,
  } = fromPresentationDocument({
    ...doc,
    userId,
    ...(folderId === undefined ? {} : { folderId }),
  });

  const deckRows = await nullifyUnknownBackgrounds(db, rawDeckRows);

  // 영구 삭제 뒤 다른 기기가 같은 문서를 다시 저장했다 — 되살린다.
  await clearTombstone(db, userId, doc.id);

  const statements = [
    // 이 프레젠테이션에 속한 기존 항목·덱을 걷어낸다.
    db
      .delete(presentationItems)
      .where(eq(presentationItems.presentationId, doc.id)),
    db.delete(decks).where(eq(decks.presentationId, doc.id)),
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
        .where(eq(presentations.id, doc.id)),
    );
  } else {
    statements.push(db.insert(presentations).values(presentation));
  }

  for (const deckRow of deckRows) {
    statements.push(db.insert(decks).values(deckRow));
  }
  for (const item of items) {
    statements.push(db.insert(presentationItems).values(item));
  }

  await runStatements(db, statements);
  return true;
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

  // rowsAffected에 기대지 않고 소유권을 먼저 확인한다. D1은 rowsAffected를
  // 주지만 테스트용 better-sqlite3 클라이언트는 주지 않아, `?? 1` 폴백이
  // 남의 문서 수정 시도까지 '성공'으로 보고한다.
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

  if (headers.length === 0) return [];

  const ids = headers.map((h: Presentation) => h.id);
  const rows = await db
    .select({ item: presentationItems, deck: decks })
    .from(presentationItems)
    .innerJoin(decks, eq(presentationItems.deckId, decks.id))
    .where(inArray(presentationItems.presentationId, ids))
    .orderBy(asc(presentationItems.order));

  const byPresentation = new Map<
    string,
    Array<{ item: typeof presentationItems.$inferSelect; deck: Deck }>
  >();
  for (const row of rows) {
    const list = byPresentation.get(row.item.presentationId) ?? [];
    list.push(row);
    byPresentation.set(row.item.presentationId, list);
  }

  return headers.map((header: Presentation) =>
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
  updatePresentation,
  getPresentationDocumentsByUserId,
  createPresentationQueries,
};
