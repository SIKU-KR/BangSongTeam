import {
  clampToClock,
  isReservedDocumentId,
  laterThan,
  MAX_PRESENTATION_TEXT_BYTES,
  toPresentationChanges,
  type PresentationChangesRequest,
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
import {
  fromPresentationChanges,
  MAX_FIRESTORE_TIME,
  toPresentationDocument,
} from "./mappers";
import { existingBackgroundIds } from "./decks";
import { isPresentationInTrash } from "./folders";
import {
  prepareDeletionPass,
  readOwnTombstone,
  runDeletionPasses,
  type DeleteForeverRefusal,
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

function byPosition(a: DeckDoc, b: DeckDoc): number {
  return (a.position ?? 0) - (b.position ?? 0);
}

function nextRevision(
  previous: Date | undefined,
  sentIso: string,
  nowMs: number,
): string {
  const revision = laterThan(
    previous?.toISOString(),
    clampToClock(sentIso, nowMs),
  );
  return Date.parse(revision) > MAX_FIRESTORE_TIME
    ? new Date(MAX_FIRESTORE_TIME).toISOString()
    : revision;
}

export type DeletePresentationResult =
  { status: "deleted" } | DeleteForeverRefusal;

/**
 * 프레젠테이션 영구 삭제 (휴지통 비우기). 담긴 사본 곡과 공유 멤버도 함께 지우고 영구 삭제
 * 기록을 남긴다.
 *
 * 서버에서 자신이나 담긴 폴더(조상 포함)가 휴지통에 있을 때만 지운다. 요청은 다른 기기에서
 * 복원하거나 밖으로 옮긴 것을 모르는 오래된 탭에서 올 수 있다. 확인은 쓰기 전에 하고, 폴더는
 * 프레젠테이션 자신이 휴지통에 없고 폴더에 담겨 있을 때만 부모까지 따라 읽는다.
 *
 * 멤버·사본이 많으면 트랜잭션 여러 개로 나눠 지우고(`runDeletionPasses`), 차례마다 확인을 다시 한다.
 */
export async function deletePresentation(
  db: Db,
  presentationId: string,
  userId: string,
): Promise<DeletePresentationResult> {
  const result = await runDeletionPasses(db, async (tx) => {
    const presentation = (
      await tx.get(presentationsCol(db).doc(presentationId))
    ).data();
    if (presentation?.userId !== userId) return "notFound";
    const inTrash = await isPresentationInTrash(
      async (id) => (await tx.get(foldersCol(db).doc(id))).data(),
      presentation,
    );
    if (!inTrash) return "conflict";
    return prepareDeletionPass(tx, db, userId, [presentationId], []);
  });
  return result.status === "deleted" ? { status: "deleted" } : result;
}

/**
 * `savePresentationChanges` 결과.
 *
 * - `saved`: 썼다. `updatedAt`은 서버가 남긴 판이라 보낸 시각과 다를 수 있다.
 * - `forbidden`: 남의 세트, 공유받은 세트(`access`), 다른 곳에 속한 덱 id, 또는 본문의
 *   `userId`가 세션 사용자가 아닌 세트. 아직 A라고 믿는 탭이나 A가 남긴 대기열이 보낸 문서를
 *   지금 쿠키의 주인인 B의 계정에 만들면 안 된다
 * - `deleted`: 내가 영구 삭제한 프레젠테이션이다(서버에 없고 내 영구 삭제 기록이 있다).
 * - `conflict`: 기준 판(`baseUpdatedAt`)이 저장된 판과 다르다. 저장된 판(`current`)을 돌려준다.
 * - `stale`: 항목이 가리키는 덱이 본문에도 서버에도 없다. 클라이언트가 서버 상태를
 *   잘못 알고 있으므로 모든 덱을 담아 다시 보내야 한다.
 * - `tooLarge`: 저장하면 담긴 곡 글(곡마다 `songTextBytes`)의 합이
 *   `MAX_PRESENTATION_TEXT_BYTES`를 넘고 지금보다 커진다. 이미 상한을 넘은 프레젠테이션이라도
 *   곡 글을 키우지 않는 저장(프레젠테이션 제목·곡 순서 바꾸기, 곡 빼기)은 받는다.
 *
 * `saved` 말고는 아무것도 쓰지 않는다.
 */
export type SavePresentationResult =
  | { status: "saved"; updatedAt: Date }
  | { status: "forbidden" }
  | { status: "deleted" }
  | { status: "conflict"; current: PresentationDocument }
  | { status: "stale" }
  | { status: "tooLarge" };

function utf8Bytes(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}

function jsonStringBytes(value: unknown): number {
  return typeof value === "string" ? utf8Bytes(JSON.stringify(value)) : 0;
}

/**
 * 곡 하나의 글(제목·아티스트·원작자 이름·가사·슬라이드)이 JSON 본문에서 차지하는 바이트.
 *
 * 저장된 글의 UTF-8 크기가 아니라 JSON으로 쓴 크기를 센다. 링크 보기 응답과 전체 저장 본문은
 * 글을 JSON으로 담는데, 제어 문자는 저장하면 1바이트지만 JSON에서는 6바이트(`\u0001`)라 저장
 * 크기로 세면 응답이 상한의 몇 배가 된다. 슬라이드는 이미 JSON 문자열로 저장하므로 그 길이를
 * 센다.
 */
export function songTextBytes(
  deck: Pick<
    DeckDoc,
    "title" | "artist" | "forkedFromAuthorName" | "lyricsRaw" | "slides"
  >,
): number {
  return (
    jsonStringBytes(deck.title) +
    jsonStringBytes(deck.artist) +
    jsonStringBytes(deck.forkedFromAuthorName) +
    jsonStringBytes(deck.lyricsRaw) +
    utf8Bytes(deck.slides)
  );
}

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
 *
 * 담긴 곡 글을 `MAX_PRESENTATION_TEXT_BYTES` 너머로 키우는 저장은 `tooLarge`로 거절한다. 바뀐
 * 곡만 보내는 저장을 거듭하면 요청 본문 상한과 상관없이 프레젠테이션을 키울 수 있는데, 링크로
 * 공유하면 로그인 없이 보는 요청마다 서버가 그 전부를 읽어 보낸다. 상한은 사본을 이미 읽는 이
 * 트랜잭션에서 세므로 읽기가 늘지 않는다.
 *
 * 문서 전체를 갈아 끼우는 저장이라 기준 판(`baseUpdatedAt`)이 오면 저장된 판과 견준다. 그사이 다른
 * 곳에서 바꿨으면(기준이 다르거나, 서버에 있는데 기준이 `null`) 쓰지 않고 `conflict`와 저장된 판을
 * 돌려준다. 그대로 쓰면 다른 기기가 넣은 곡을 지우고 바꾼 순서·제목을 되돌린다. 저장된 판은 이미 읽은
 * 머리·사본으로 만들어 읽기가 늘지 않는다. 견주기는 주인 확인 뒤, `stale` 앞에 한다. 남의 세트를
 * 돌려주지 않고, 낡은 기기가 모든 곡 다시 보내기로 지운 곡을 되살리지 않게 하기 위해서다. 기준이 없는
 * 이전 클라이언트의 저장은 견주지 않고 받는다. 서버에 없는 id는 기준과 상관없이 만든다.
 *
 * 저장된 `updatedAt`은 판이고 받은 저장마다 커진다. 보낸 시각을 서버 시계 + 5분까지로 줄여 쓰되, 저장된
 * 판보다 늦지 않으면 저장된 판 + 1ms로 쓴다(`laterThan`). 되돌리기처럼 옛 시각을 담은 저장도 모든
 * 기기에서 새 판이 되고, 빠른 시계가 판을 미래에 박아 두지 못한다. Firestore가 담는 마지막 시각
 * (`MAX_FIRESTORE_TIME`)에 박힌 판만은 그대로 둔다. 1ms를 더한 값은 담지 못해 1970년으로 바뀌고,
 * 판이 거꾸로 간다.
 *
 * 영구 삭제는 되돌리지 않는다. 서버에 없고 내 영구 삭제 기록이 있는 id는 기준과 상관없이 쓰지 않고
 * `deleted`다(`readOwnTombstone`).
 */
export async function savePresentationChanges(
  db: Db,
  userId: string,
  changes: PresentationChangesRequest,
  now: Date = new Date(),
): Promise<SavePresentationResult> {
  if (changes.access) return { status: "forbidden" };
  if (changes.userId !== userId) return { status: "forbidden" };

  const sentDeckIds = changes.decks.map((deck) => deck.id);
  const forkedFromIds = [
    ...new Set(
      changes.decks.flatMap((deck) =>
        deck.forkedFrom && !isReservedDocumentId(deck.forkedFrom)
          ? [deck.forkedFrom]
          : [],
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
      tombstone,
    ] = await Promise.all([
      tx.get(ref),
      tx.get(decksCol(db).where("presentationId", "==", changes.id)),
      changes.folderId && !isReservedDocumentId(changes.folderId)
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
      readOwnTombstone(tx, db, userId, "presentation", changes.id),
    ]);

    const existing = existingSnapshot.data();
    if (existing && existing.userId !== userId) return { status: "forbidden" };
    if (!existing && tombstone.exists) return { status: "deleted" };

    const existingCopies = copiesSnapshot.docs.map((doc) => doc.data());
    const base = changes.baseUpdatedAt;
    if (
      existing &&
      base !== undefined &&
      (base === null || Date.parse(base) !== existing.updatedAt.getTime())
    ) {
      return {
        status: "conflict",
        current: toPresentationDocument(
          existing,
          [...existingCopies].sort(byPosition),
        ),
      };
    }

    const sentDecksElsewhere = sentDecks.some((snapshot) => {
      const deck = snapshot.data();
      return (
        deck !== undefined &&
        (deck.presentationId !== changes.id || deck.userId !== userId)
      );
    });
    if (sentDecksElsewhere) return { status: "forbidden" };

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
      updatedAt: nextRevision(
        existing?.updatedAt,
        changes.updatedAt,
        now.getTime(),
      ),
      ...(folderId === undefined ? {} : { folderId }),
    });

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
    if (missingDeck) return { status: "stale" };

    const savedBytes = slots.reduce((sum, slot) => {
      const row = sent.get(slot.deckId) ?? previous.get(slot.deckId);
      return sum + (row ? songTextBytes(row) : 0);
    }, 0);
    const storedBytes = existingCopies.reduce(
      (sum, copy) => sum + songTextBytes(copy),
      0,
    );
    if (savedBytes > MAX_PRESENTATION_TEXT_BYTES && savedBytes > storedBytes) {
      return { status: "tooLarge" };
    }

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

    tombstone.clear();

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

    return { status: "saved", updatedAt: presentation.updatedAt };
  });
}

/**
 * 프레젠테이션 문서 업서트 (문서 단위 전체 교체). 모든 덱을 담은 변경분 저장과 같다.
 * 소유자가 다르거나, 공유받은 세트거나, 문서의 `userId`가 세션 사용자가 아니거나, 영구 삭제한
 * 프레젠테이션이면 아무것도 쓰지 않고 false를 돌린다.
 */
export async function upsertPresentationDocument(
  db: Db,
  userId: string,
  doc: PresentationDocument,
): Promise<boolean> {
  const result = await savePresentationChanges(
    db,
    userId,
    toPresentationChanges(doc),
  );
  return result.status === "saved";
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
      (byPresentation.get(header.id) ?? []).sort(byPosition),
    ),
  );
}
