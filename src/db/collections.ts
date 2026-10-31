import { createHash } from "node:crypto";
import {
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "@google-cloud/firestore";
import type { BackgroundKind, LinkAccess } from "#shared";
import type { Db } from "./client";

/**
 * Firestore 컬렉션과 문서 모양.
 *
 * - 문서 id는 엔터티 id다. 시각은 `Date`로 읽고 쓴다(저장은 Timestamp).
 * - 비어 있는 값은 필드를 빼지 않고 `null`로 쓴다. `where(field, "==", null)`은 필드가
 *   없는 문서를 찾지 못한다.
 * - Firestore에는 외래키·CHECK·트리거가 없다. 그 규칙은 쓰기 경로(`queries/*`)가 트랜잭션
 *   안에서 지킨다. 어느 규칙을 어디서 지키는지는 각 문서 타입에 적는다.
 * - 서버(Admin 자격)만 읽고 쓴다. 브라우저 접근은 `firestore.rules`가 모두 막는다.
 */
export const COLLECTIONS = {
  users: "users",
  userEmails: "userEmails",
  sessions: "sessions",
  accounts: "accounts",
  verifications: "verifications",
  decks: "decks",
  presentations: "presentations",
  presentationMembers: "presentationMembers",
  folders: "folders",
  driveTombstones: "driveTombstones",
  backgrounds: "backgrounds",
  signUpQuotas: "signUpQuotas",
} as const;

/**
 * 사용자. Better Auth `user` 모델에 약관 동의 시각을 더한다. 세션·계정·인증
 * 요청 문서는 Better Auth 어댑터(`auth/firestoreAdapter.ts`)가 같은 방식으로 쓴다. 어댑터는
 * 이메일 예약(`UserEmailDoc`)과 함께 만들고 함께 지운다.
 */
export interface UserDoc {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  image: string | null;
  termsAgreedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 이메일 하나에 사용자 하나만 두는 예약. 문서 id는 `userEmailDocId(email)`이다.
 *
 * Firestore에는 고유 제약이 없어, 인증 어댑터가 이 예약과 사용자 문서를 한 트랜잭션에서 만든다
 * (`auth/userEmails.ts`). 가리키는 사용자가 없는 예약은 남은 것이라 새 사용자가 가져간다.
 * 이메일을 바꾸는 기능은 켜져 있지 않다. 켜면 예약도 함께 옮겨야 한다. 예약이 생기기 전에
 * 만든 사용자는 예약이 없고, 같은 이메일의 가입은 Better Auth의 이메일 조회가 먼저 막는다.
 */
export interface UserEmailDoc {
  userId: string;
}

/**
 * 곡. 보관함 곡과 프레젠테이션 사본을 한 컬렉션에 담는다.
 *
 * - `presentationId`가 없으면 보관함 곡, 있으면 그 프레젠테이션 전용 사본이다. 사본만
 *   프레젠테이션 안의 자리(`itemId`·`position`)를 가진다.
 * - `forkedFrom`: 사본이면 담아 온 보관함 곡, 보관함 곡이면 예전 공유 라이브러리에서 가져온
 *   곡이다. 가리키던 곡이 지워지면 `null`로 바뀐다(`detachForks`). `forkedFromAuthorName`은 원작
 *   표시 스냅샷이라 원본이 지워져도 남는다.
 * - `backgroundId`는 서버에 있는 배경만 가리킨다. 모르는 배경은 저장할 때 `null`로 낮춘다.
 * - 보관함 곡의 `updatedAt`·`createdAt`은 서버 시계 + 5분까지로 줄여 쓰고, `createdAt`은 처음
 *   저장한 값을 지킨다(`upsertDeck`).
 * - 공유 라이브러리를 걷어내기 전에 저장한 문서에는 `visibility`·`publishedAt`·`takedownAt`·
 *   `forkCount`·`listed`·`searchGrams`가 남아 있다. 읽지 않고, 보관함 곡을 다시 저장해도 그대로
 *   둔다. 되돌린 판이 그 곡의 공개 상태를 잃지 않는다.
 */
export interface DeckDoc {
  id: string;
  userId: string;
  presentationId: string | null;
  itemId: string | null;
  position: number | null;
  title: string;
  artist: string;
  lyricsRaw: string;
  /** 슬라이드 배열 JSON. Firestore는 배열 안의 배열을 담지 못해 문자열로 둔다 */
  slides: string;
  /** 스타일 객체 JSON */
  style: string;
  backgroundId: string | null;
  forkedFrom: string | null;
  forkedFromAuthorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 프레젠테이션 머리. 담긴 곡은 `decks`의 사본 문서다. 지우면 사본·멤버도 함께 지운다. */
export interface PresentationDoc {
  id: string;
  userId: string;
  title: string;
  serviceDate: string;
  folderId: string | null;
  trashedAt: Date | null;
  linkAccess: LinkAccess;
  linkToken: string | null;
  createdAt: Date;
  /**
   * 문서의 판. 받은 저장마다 커지기만 한다(`savePresentationChanges`가 서버 시계 + 5분까지로 줄인
   * 보낸 시각이나 앞 판 + 1ms로 쓴다). 저장 요청의 기준 판(`baseUpdatedAt`)을 이 값과 견준다.
   */
  updatedAt: Date;
}

/**
 * 공유 링크로 세트를 연 사람(보기 전용). 문서 id는 `memberDocId`다. 소유자가 링크를 끄면
 * 접근을 잃고 다시 켜면 되찾는다. 링크를 재설정하면 모두 지워 접근을 끊는다.
 */
export interface PresentationMemberDoc {
  presentationId: string;
  userId: string;
}

/**
 * 드라이브 폴더 트리 인접 리스트. `updatedAt`과 처음 저장한 `createdAt`은 서버 시계 + 5분까지로 줄여
 * 쓴다(`upsertFolder`). 저장은 `updatedAt`이 늦은 쪽이 이긴다.
 */
export interface FolderDoc {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  trashedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 오프라인 우선 동기화에서 영구 삭제를 다른 기기로 전하는 기록.
 *
 * 폴더·프레젠테이션 기록의 문서 id는 항목 id다. 보관함 곡 기록은 `deckTombstoneDocId`로
 * 접두사를 붙여 드라이브 기록과 id를 나누지 않는다. 그래서 드라이브 쪽 쓰기·읽기는 곡 기록을
 * 덮거나 지우지 않고, 곡을 지우는 요청이 남의 프레젠테이션 기록 자리를 먼저 차지하지도 못한다.
 *
 * 기록의 주인이 같은 id로 보낸 저장은 그 항목을 다시 만들지 않는다(410, `readOwnTombstone`,
 * `upsertDeck`).
 */
export interface DriveTombstoneDoc {
  itemId: string;
  userId: string;
  kind: "folder" | "presentation" | "deck";
}

/**
 * 배경 갤러리. 모두 관리자가 올리는 기본 제공 배경이다. 문서는 GCS 객체(`mediaKey`·
 * `posterKey`)가 올라간 뒤에만 만든다. 파일 없는 문서는 편집기·송출에서 깨진 배경이 된다.
 */
export interface BackgroundDoc {
  id: string;
  title: string;
  kind: BackgroundKind;
  mediaKey: string;
  posterKey: string;
  durationSec: number;
  sizeBytes: number;
  license: string;
  description: string;
  /** 스틸컷을 보고 붙인 검색 키워드 */
  keywords: string[];
  createdAt: Date;
}

/**
 * IP 하나에서 그날(한국 시간) 받은 이메일 가입 수(`queries/limits.ts`). 문서 id는
 * `signUpQuotaDocId`이고, IP는 서버가 비밀값으로 해시한 키로만 남는다. 지난 날의 문서는 TTL
 * 정책(`firestore.indexes.json`)이 지운다.
 */
export interface SignUpQuotaDoc {
  /** 한국 시간 날짜(YYYY-MM-DD) */
  day: string;
  signUps: number;
  expiresAt: Date;
}

/** 저장된 Timestamp를 `Date`로 바꿔 읽는다. 중첩 값은 쓰지 않으므로 맨 위 필드만 본다 */
export function fromFirestoreData(data: DocumentData): DocumentData {
  const out: DocumentData = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Timestamp ? value.toDate() : value;
  }
  return out;
}

function converter<T extends object>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snapshot: QueryDocumentSnapshot) =>
      fromFirestoreData(snapshot.data()) as T,
  };
}

function typed<T extends object>(db: Db, name: string): CollectionReference<T> {
  return db.collection(name).withConverter(converter<T>());
}

export const usersCol = (db: Db) => typed<UserDoc>(db, COLLECTIONS.users);
export const userEmailsCol = (db: Db) =>
  typed<UserEmailDoc>(db, COLLECTIONS.userEmails);
export const decksCol = (db: Db) => typed<DeckDoc>(db, COLLECTIONS.decks);
export const presentationsCol = (db: Db) =>
  typed<PresentationDoc>(db, COLLECTIONS.presentations);
export const presentationMembersCol = (db: Db) =>
  typed<PresentationMemberDoc>(db, COLLECTIONS.presentationMembers);
export const foldersCol = (db: Db) => typed<FolderDoc>(db, COLLECTIONS.folders);
export const driveTombstonesCol = (db: Db) =>
  typed<DriveTombstoneDoc>(db, COLLECTIONS.driveTombstones);
export const backgroundsCol = (db: Db) =>
  typed<BackgroundDoc>(db, COLLECTIONS.backgrounds);
export const signUpQuotasCol = (db: Db) =>
  typed<SignUpQuotaDoc>(db, COLLECTIONS.signUpQuotas);

/**
 * 이메일 예약 문서 id: 소문자로 맞춘 이메일의 SHA-256(16진수). 이메일에 든 `/` 같은 문자가
 * 문서 경로를 깨지 않고, 콘솔·로그에 남는 문서 경로에 주소가 드러나지 않는다.
 */
export function userEmailDocId(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex");
}

/** 멤버 문서 id. id 알파벳(NanoID)에 `:`가 없으므로 두 id를 이어도 겹치지 않는다 */
export function memberDocId(presentationId: string, userId: string): string {
  return `${presentationId}:${userId}`;
}

/**
 * 보관함 곡 삭제 기록의 문서 id. id 알파벳(NanoID)에 `:`가 없으므로 항목 id를 그대로 쓰는
 * 폴더·프레젠테이션 기록과 겹치지 않는다.
 */
export function deckTombstoneDocId(deckId: string): string {
  return `deck:${deckId}`;
}

/** 이메일 가입 하루 한도 문서 id. 키는 16진수 해시라 `:`가 없다 */
export function signUpQuotaDocId(key: string, day: string): string {
  return `${key}:${day}`;
}

/**
 * Firestore `in` 조건이 받는 값 수(30)로 id를 나눈다.
 * https://firebase.google.com/docs/firestore/query-data/queries#limits_on_or_queries
 */
const MAX_IN_VALUES = 30;

export function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IN_VALUES) {
    chunks.push(ids.slice(i, i + MAX_IN_VALUES));
  }
  return chunks;
}
