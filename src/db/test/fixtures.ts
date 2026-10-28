import { randomUUID } from "node:crypto";
import { createFirestore, type Db } from "../client";
import {
  backgroundsCol,
  decksCol,
  foldersCol,
  presentationMembersCol,
  presentationsCol,
  usersCol,
  memberDocId,
  type BackgroundDoc,
  type DeckDoc,
  type FolderDoc,
  type PresentationDoc,
  type UserDoc,
} from "../collections";
import { withDeckIndex } from "../deckIndex";

const EPOCH = new Date(0);

/**
 * 테스트마다 비어 있는 Firestore. 에뮬레이터(`config/firestoreEmulator.ts`)에 매번 새
 * 프로젝트 id로 붙으므로 다른 테스트·파일과 데이터를 나누지 않는다.
 */
const projectIds = new WeakMap<Db, string>();

export function createTestDb(): Db {
  const projectId = `test-${randomUUID()}`;
  const db = createFirestore({ projectId });
  projectIds.set(db, projectId);
  return db;
}

/** 테스트 Firestore의 모든 문서를 지운다 (에뮬레이터 전용 API) */
export async function clearDb(db: Db): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${projectIds.get(db)}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`clearDb failed: ${res.status}`);
}

/** 사용자 문서. 이름 외 필드는 비우고 시각 0을 채운다 */
export function userDoc(row: Pick<UserDoc, "id"> & Partial<UserDoc>): UserDoc {
  return {
    name: row.id,
    email: null,
    emailVerified: false,
    image: null,
    termsAgreedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  };
}

/**
 * 곡 문서. 빈 곡 내용과 시각 0을 채우고 공개 범위·검색 색인을 붙인다.
 * 프레젠테이션 사본은 `presentationId`·`itemId`·`position`을 함께 넘긴다.
 */
export function deckDoc(
  row: Pick<DeckDoc, "id" | "userId"> &
    Partial<Omit<DeckDoc, "listed" | "searchGrams">>,
): DeckDoc {
  return withDeckIndex({
    presentationId: null,
    itemId: null,
    position: null,
    title: "song",
    artist: "",
    lyricsRaw: "lyrics",
    slides: "[]",
    style: "{}",
    backgroundId: null,
    forkedFrom: null,
    forkedFromAuthorName: null,
    visibility: "private",
    publishedAt: null,
    takedownAt: null,
    forkCount: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  });
}

/** 프레젠테이션 머리 문서 */
export function presentationDoc(
  row: Pick<PresentationDoc, "id" | "userId"> & Partial<PresentationDoc>,
): PresentationDoc {
  return {
    title: "세트",
    serviceDate: "2026-09-27",
    folderId: null,
    trashedAt: null,
    linkAccess: "off",
    linkToken: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  };
}

/**
 * 사본 곡이 `copies`곡씩 담긴 프레젠테이션 `count`개. Firestore `in` 조건 한도(30)를 넘는
 * 조회·삭제를 시험할 때 쓴다. 사본 id는 자리의 역순으로 정렬되게 붙여, 읽는 쪽이 자리순으로
 * 다시 세우는지도 함께 드러난다.
 */
export function presentationsWithCopies(
  userId: string,
  count: number,
  copies: number,
  overrides: Partial<PresentationDoc> = {},
): { presentations: PresentationDoc[]; decks: DeckDoc[] } {
  const pad = (value: number, width: number) =>
    String(value).padStart(width, "0");
  const presentations = Array.from({ length: count }, (_, index) =>
    presentationDoc({ id: `p${pad(index, 20)}`, userId, ...overrides }),
  );
  const decks = presentations.flatMap((presentation, index) =>
    Array.from({ length: copies }, (_, position) =>
      deckDoc({
        id: `d${pad(index, 10)}${pad(copies - position, 10)}`,
        userId,
        presentationId: presentation.id,
        itemId: `i${pad(index, 10)}${pad(position, 10)}`,
        position,
      }),
    ),
  );
  return { presentations, decks };
}

/** 폴더 문서 */
export function folderDoc(
  row: Pick<FolderDoc, "id" | "userId"> & Partial<FolderDoc>,
): FolderDoc {
  return {
    parentId: null,
    name: "폴더",
    trashedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  };
}

/** 배경 문서 */
export function backgroundDoc(
  row: Pick<BackgroundDoc, "id"> & Partial<BackgroundDoc>,
): BackgroundDoc {
  return {
    title: `배경 ${row.id}`,
    kind: "video",
    mediaKey: `loops/${row.id}.mp4`,
    posterKey: `posters/${row.id}.webp`,
    durationSec: 20,
    sizeBytes: 0,
    license: "",
    description: "",
    keywords: [],
    createdAt: EPOCH,
    ...row,
  };
}

/** 문서들을 한 번에 넣는다 */
export async function seedDocs(
  db: Db,
  docs: {
    users?: UserDoc[];
    decks?: DeckDoc[];
    presentations?: PresentationDoc[];
    folders?: FolderDoc[];
    backgrounds?: BackgroundDoc[];
    members?: { presentationId: string; userId: string }[];
  },
): Promise<void> {
  const batch = db.batch();
  for (const row of docs.users ?? []) batch.set(usersCol(db).doc(row.id), row);
  for (const row of docs.decks ?? []) batch.set(decksCol(db).doc(row.id), row);
  for (const row of docs.presentations ?? []) {
    batch.set(presentationsCol(db).doc(row.id), row);
  }
  for (const row of docs.folders ?? []) {
    batch.set(foldersCol(db).doc(row.id), row);
  }
  for (const row of docs.backgrounds ?? []) {
    batch.set(backgroundsCol(db).doc(row.id), row);
  }
  for (const row of docs.members ?? []) {
    batch.set(
      presentationMembersCol(db).doc(
        memberDocId(row.presentationId, row.userId),
      ),
      row,
    );
  }
  await batch.commit();
}
