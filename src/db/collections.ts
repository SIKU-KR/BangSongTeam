import { createHash } from "node:crypto";
import {
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "@google-cloud/firestore";
import type {
  BackgroundKind,
  DeckVisibility,
  LinkAccess,
  ReportReason,
} from "#shared";
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
  reports: "reports",
  moderationEvents: "moderationEvents",
  userQuotas: "userQuotas",
  signUpQuotas: "signUpQuotas",
} as const;

/**
 * 사용자. Better Auth `user` 모델에 약관 동의 시각과 계정 제한 시각을 더한다. 세션·계정·인증
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
  /**
   * 운영자가 계정을 제한한 시각(`ops/moderation.ts`의 `banUser`). 이 필드가 생기기 전에 만든
   * 사용자 문서에는 없으므로 `isBannedUser`로 읽는다.
   */
  bannedAt: Date | null;
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
 *   프레젠테이션 안의 자리(`itemId`·`position`)를 가지며 언제나 비공개다.
 * - `forkedFrom`: 보관함 곡이면 가져온 공개 곡, 사본이면 담아 온 보관함 곡. 가리키던 곡이
 *   지워지면 `null`로 바뀐다(`detachForks`). `forkedFromAuthorName`은 원작 표시 스냅샷이라
 *   원본이 지워져도 남는다. 이 값이 있으면 공유 라이브러리에서 가져온 곡이다.
 * - `forkCount`는 `forkedFrom`이 이 곡인 보관함 곡 수다. 가져오기·삭제 트랜잭션이 함께 고친다.
 * - `backgroundId`는 서버에 있는 배경만 가리킨다. 모르는 배경은 저장할 때 `null`로 낮춘다.
 * - `listed`·`searchGrams`는 공개 범위와 검색 색인이다. `withDeckIndex`만 정한다.
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
  visibility: DeckVisibility;
  publishedAt: Date | null;
  takedownAt: Date | null;
  forkCount: number;
  createdAt: Date;
  updatedAt: Date;
  listed: boolean;
  searchGrams: string[];
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

/** 드라이브 폴더 트리 인접 리스트 */
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
 * 공개 곡 신고·교정 제안. 처리는 `ops/moderation.ts`로 한다. 신고한 사람이나 곡이 지워져도
 * 처리 기록은 남기려고 두 id는 `null`로 바뀐다.
 *
 * `targetUserId`·`targetTitle`은 접수할 때의 곡 주인과 제목이다. 곡이 지워져 `deckId`가 비어도
 * 누구의 무슨 곡을 신고했는지 남긴다. 이 필드가 생기기 전에 받은 신고에는 없다.
 */
export interface ReportDoc {
  id: string;
  reporterId: string | null;
  deckId: string | null;
  targetUserId: string | null;
  targetTitle: string | null;
  reason: ReportReason;
  details: string | null;
  status: "pending" | "resolved" | "rejected";
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}

/**
 * 운영 기록: 게시 중단·해제와 계정 제한·해제. 그 일과 같은 트랜잭션에서 쓴다
 * (`queries/takedowns.ts`의 `recordModerationEvent`). 곡이 지워져도 남아, 누구의 곡을 무슨 제목으로
 * 게시 중단했는지 보고 같은 사람이 다시 올린 곡을 알아본다. 문서 id는 `createId()`다.
 */
export interface ModerationEventDoc {
  id: string;
  action: "takedown" | "restore" | "ban" | "unban";
  /**
   * 왜 한 일인지. `direct`는 운영자가 이 곡이나 계정을 골라 한 일, `fork`는 가져온 원본
   * (`sourceDeckId`)이 게시 중단돼 함께 막은 곡, `ban`은 주인의 계정을 제한하며 함께 막은 곡이다.
   * `fork`로 막힌 곡의 주인은 원본을 가져갔을 뿐 그 가사를 올린 사람이 아니므로, 같은 사람이 다시
   * 올린 곡을 찾을 때는 빼고 본다.
   */
  cause: "direct" | "fork" | "ban";
  /** `fork`일 때 게시 중단된 원본 곡 id. 아니면 `null` */
  sourceDeckId: string | null;
  /** 운영자가 남긴 사유(`scripts/moderation.mjs`의 `--note`). 없으면 `null` */
  note: string | null;
  /** 곡 주인이나 제한한 계정 */
  userId: string;
  /** 곡에 한 일이면 곡 id와 그때의 제목, 계정에 한 일이면 `null` */
  deckId: string | null;
  title: string | null;
  at: Date;
}

/**
 * 사용자 한 명이 그날(한국 시간) 쓴 공유 라이브러리 쓰기 수(`queries/limits.ts`). 문서 id는
 * `userQuotaDocId`다. 지난 날의 문서는 TTL 정책(`firestore.indexes.json`)이 지운다.
 */
export interface UserQuotaDoc {
  userId: string;
  /** 한국 시간 날짜(YYYY-MM-DD) */
  day: string;
  publish: number;
  fork: number;
  report: number;
  expiresAt: Date;
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
export const reportsCol = (db: Db) => typed<ReportDoc>(db, COLLECTIONS.reports);
export const moderationEventsCol = (db: Db) =>
  typed<ModerationEventDoc>(db, COLLECTIONS.moderationEvents);
export const userQuotasCol = (db: Db) =>
  typed<UserQuotaDoc>(db, COLLECTIONS.userQuotas);
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

/** 사용자 하루 한도 문서 id. 사용자 id(NanoID)에 `:`가 없으므로 날짜와 이어도 겹치지 않는다 */
export function userQuotaDocId(userId: string, day: string): string {
  return `${userId}:${day}`;
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
