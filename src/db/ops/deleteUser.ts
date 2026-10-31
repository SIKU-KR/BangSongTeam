import type { Query } from "@google-cloud/firestore";
import { ID_PATTERN, isReservedDocumentId } from "#shared";
import { runBulk, type Db } from "../client";
import {
  chunkIds,
  COLLECTIONS,
  decksCol,
  driveTombstonesCol,
  foldersCol,
  presentationMembersCol,
  presentationsCol,
  usersCol,
} from "../collections";
import { prepareDeletionPass, runDeletionPasses } from "../queries/cascade";
import { deleteDeckScoped } from "../queries/decks";

/**
 * 한 사용자의 남은 데이터 수.
 *
 * `forksByOthers`는 그 사람의 보관함 곡을 가리키는 다른 사용자의 곡·사본 수다. 그 곡들은 다른
 * 사용자의 것이라 지우지 않고(개인정보처리방침 4항) 원본 연결(`forkedFrom`)만 끊는다.
 */
export interface UserDataCounts {
  user: number;
  sessions: number;
  accounts: number;
  /** 이메일 예약(`userEmails`). 사용자 문서가 먼저 지워졌어도 남을 수 있어 따로 센다 */
  emailReservations: number;
  presentations: number;
  libraryDecks: number;
  /** 보관함 곡이 아닌 곡: 프레젠테이션 사본 */
  otherDecks: number;
  folders: number;
  /** 다른 사람의 프레젠테이션에 링크로 들어간 기록 */
  memberships: number;
  tombstones: number;
  forksByOthers: number;
}

/** 운영자가 본인 확인한 사람과 견줄 계정 정보 */
export interface AccountIdentity {
  name: string;
  email: string | null;
  createdAt: Date;
}

export interface RevokeUserAccessResult {
  sessions: number;
  accounts: number;
  user: boolean;
}

export interface DeleteUserDataResult {
  before: UserDataCounts;
  remaining: UserDataCounts;
}

function isUserId(userId: string): boolean {
  return ID_PATTERN.test(userId) && !isReservedDocumentId(userId);
}

async function count(query: Query): Promise<number> {
  return (await query.count().get()).data().count;
}

function byUser(db: Db, collection: string, userId: string): Query {
  return db.collection(collection).where("userId", "==", userId);
}

function libraryDecksOf(db: Db, userId: string): Query {
  return decksCol(db)
    .where("userId", "==", userId)
    .where("presentationId", "==", null);
}

async function countForksByOthers(db: Db, userId: string): Promise<number> {
  const library = await libraryDecksOf(db, userId).select().get();
  let forks = 0;
  for (const ids of chunkIds(library.docs.map((doc) => doc.id))) {
    const pointing = await decksCol(db)
      .where("forkedFrom", "in", ids)
      .select("userId")
      .get();
    forks += pointing.docs.filter((doc) => doc.get("userId") !== userId).length;
  }
  return forks;
}

/**
 * 지우거나 바꿀 계정의 이름·이메일·가입 시각. 사용자 문서가 없으면 `null`이다.
 * `scripts/deleteUser.mjs`와 `scripts/accountRecovery.mjs`가 미리보기 첫머리에 보여 준다. 데이터 수만
 * 보여 주면 id를 잘못 적어 다른 사람의 계정을 골라도 알아채기 어렵다.
 */
export async function getAccountIdentity(
  db: Db,
  userId: string,
): Promise<AccountIdentity | null> {
  if (!isUserId(userId)) return null;
  const user = (await usersCol(db).doc(userId).get()).data();
  return user
    ? { name: user.name, email: user.email, createdAt: user.createdAt }
    : null;
}

/** 한 사용자의 데이터가 얼마나 남았는지 센다. 읽기만 한다 */
export async function countUserData(
  db: Db,
  userId: string,
): Promise<UserDataCounts> {
  const [
    user,
    sessions,
    accounts,
    emailReservations,
    presentations,
    decks,
    libraryDecks,
    folders,
    memberships,
    tombstones,
    forksByOthers,
  ] = await Promise.all([
    isUserId(userId)
      ? usersCol(db)
          .doc(userId)
          .get()
          .then((snapshot) => (snapshot.exists ? 1 : 0))
      : 0,
    count(byUser(db, COLLECTIONS.sessions, userId)),
    count(byUser(db, COLLECTIONS.accounts, userId)),
    count(byUser(db, COLLECTIONS.userEmails, userId)),
    count(presentationsCol(db).where("userId", "==", userId)),
    count(decksCol(db).where("userId", "==", userId)),
    count(libraryDecksOf(db, userId)),
    count(foldersCol(db).where("userId", "==", userId)),
    count(presentationMembersCol(db).where("userId", "==", userId)),
    count(driveTombstonesCol(db).where("userId", "==", userId)),
    countForksByOthers(db, userId),
  ]);
  return {
    user,
    sessions,
    accounts,
    emailReservations,
    presentations,
    libraryDecks,
    otherDecks: decks - libraryDecks,
    folders,
    memberships,
    tombstones,
    forksByOthers,
  };
}

async function deleteSignIn(
  db: Db,
  userId: string,
): Promise<RevokeUserAccessResult> {
  const [sessions, accounts, reservations, user] = await Promise.all([
    byUser(db, COLLECTIONS.sessions, userId).select().get(),
    byUser(db, COLLECTIONS.accounts, userId).select().get(),
    byUser(db, COLLECTIONS.userEmails, userId).select().get(),
    isUserId(userId) ? usersCol(db).doc(userId).get() : null,
  ]);
  await runBulk(db, (writer) => [
    ...[...sessions.docs, ...accounts.docs, ...reservations.docs].map((doc) =>
      writer.delete(doc.ref),
    ),
    ...(user?.exists ? [writer.delete(user.ref)] : []),
  ]);
  return {
    sessions: sessions.size,
    accounts: accounts.size,
    user: user?.exists === true,
  };
}

/**
 * 계정 삭제 첫 단계: 그 계정으로 다시 들어오는 길을 끊는다. 세션·연결된 로그인(비밀번호·소셜)·
 * 사용자 문서·이메일 예약을 지운다. 사용자 문서에 있는 약관 동의 기록도 함께 사라진다.
 * 이메일 예약은 사용자 문서의 이메일이 아니라 예약이 가리키는 사용자 id로 찾는다. 사용자 문서를
 * 콘솔에서 먼저 지웠거나 지우다 멈췄어도 이메일 해시와 사용자 id를 담은 예약이 남지 않게 한다.
 *
 * 이미 로그인한 기기는 세션 쿠키 캐시(`SESSION_COOKIE_CACHE_SECONDS`, 5분) 동안 세션을 다시
 * 확인하지 않아 계속 쓸 수 있다. 외래키가 없어 Firestore는 지운 사용자 id로 오는 쓰기도 받으므로,
 * 그동안 그 기기가 저장하거나 부팅 동기화로 다시 올린 데이터는 캐시가 끝난 뒤 `deleteUserData`가
 * 지운다. 같은 소셜 계정이나 이메일로 다시 로그인하면 새 사용자가 된다.
 */
export async function revokeUserAccess(
  db: Db,
  userId: string,
): Promise<RevokeUserAccessResult> {
  return deleteSignIn(db, userId);
}

async function deletePresentationsAndFolders(
  db: Db,
  userId: string,
): Promise<void> {
  await runDeletionPasses(db, async (tx) => {
    const [presentations, folders] = await Promise.all([
      tx.get(presentationsCol(db).where("userId", "==", userId).select()),
      tx.get(foldersCol(db).where("userId", "==", userId).select()),
    ]);
    if (presentations.empty && folders.empty) return "notFound";
    return prepareDeletionPass(
      tx,
      db,
      userId,
      presentations.docs.map((doc) => doc.id),
      folders.docs.map((doc) => doc.id),
    );
  });
}

async function deleteDecksOf(db: Db, userId: string): Promise<void> {
  const decks = await decksCol(db)
    .where("userId", "==", userId)
    .select("presentationId")
    .get();
  for (const doc of decks.docs) {
    if (doc.get("presentationId") === null) {
      await deleteDeckScoped(db, doc.id, userId);
      continue;
    }
    await db.runTransaction(async (tx) => {
      const pointing = await tx.get(
        decksCol(db).where("forkedFrom", "==", doc.id).select(),
      );
      tx.delete(doc.ref);
      for (const dependent of pointing.docs) {
        tx.update(dependent.ref, { forkedFrom: null });
      }
    });
  }
}

/**
 * 한 사용자의 데이터를 모두 지운다(회원 탈퇴). 외래키가 사라진 D1의 `DELETE FROM user` 연쇄를
 * 대신한다. `scripts/deleteUser.mjs`가 `revokeUserAccess`를 먼저 부르고 세션 쿠키 캐시가 끝나기를
 * 기다린 뒤 부른다. 바로 부르면 아직 로그인된 기기가 지운 데이터를 다시 올릴 수 있다.
 *
 * - 프레젠테이션은 사본 곡·공유 멤버와 함께, 폴더와 함께 차례로 나눠 지운다(`runDeletionPasses`).
 *   휴지통에 있는지는 보지 않는다.
 * - 보관함 곡은 곡 삭제(`deleteDeckScoped`)를 거쳐, 이 곡을 가리키던 다른 사용자의 곡·사본의
 *   연결을 끊는다. 다른 사용자가 가져간 곡과 담은 사본은 지우지 않는다.
 * - 그래도 남은 사본(이미 없는 프레젠테이션을 가리키던 곡)과 다른 사람의 프레젠테이션 멤버 기록,
 *   영구 삭제 기록(이 작업이 남긴 것 포함)을 지운다.
 * - 마지막에 로그인 수단과 사용자 문서를 다시 지운다(`revokeUserAccess`와 같다).
 *
 * 같음 조건만 써서 복합 색인이 필요 없고 저장 모양도 바꾸지 않는다. 중간에 멈추면 다시 실행해 이어서
 * 지운다. 지우기 전과 뒤의 데이터 수를 돌려주며, 뒤의 수는 모두 0이어야 한다.
 */
export async function deleteUserData(
  db: Db,
  userId: string,
): Promise<DeleteUserDataResult> {
  const before = await countUserData(db, userId);

  await deletePresentationsAndFolders(db, userId);
  await deleteDecksOf(db, userId);

  const [memberships, tombstones] = await Promise.all([
    presentationMembersCol(db).where("userId", "==", userId).select().get(),
    driveTombstonesCol(db).where("userId", "==", userId).select().get(),
  ]);
  await runBulk(db, (writer) =>
    [...memberships.docs, ...tombstones.docs].map((doc) =>
      writer.delete(doc.ref),
    ),
  );
  await deleteSignIn(db, userId);

  return { before, remaining: await countUserData(db, userId) };
}
