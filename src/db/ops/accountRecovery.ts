import type { DocumentReference, Query } from "@google-cloud/firestore";
import { z } from "zod";
import { createId, ID_PATTERN, isReservedDocumentId } from "#shared";
import { runBulk, type Db } from "../client";
import {
  chunkIds,
  COLLECTIONS,
  decksCol,
  foldersCol,
  memberDocId,
  presentationMembersCol,
  presentationsCol,
  userEmailDocId,
  userEmailsCol,
  usersCol,
} from "../collections";

const SOCIAL_ONLY_PROVIDERS = new Set(["kakao", "naver"]);

const CHUNK_SIZE = 200;

const DECK_CHUNK_SIZE = 50;

const EmailSchema = z.email();

function isUserId(userId: string): boolean {
  return ID_PATTERN.test(userId) && !isReservedDocumentId(userId);
}

function accountsOf(db: Db, userId: string): Query {
  return db.collection(COLLECTIONS.accounts).where("userId", "==", userId);
}

/** 카카오·네이버 계정만 연결된 사용자를 이메일 종류마다 센 값 */
export interface SocialOnlyUsers {
  total: number;
  /** 프로바이더가 이메일을 주지 않아 만든 주소(`SYNTHETIC_EMAIL_DOMAIN`) */
  syntheticEmail: number;
  /** 인증된 실제 이메일. 같은 이메일의 Google 로그인이 이 계정에 묶인다 */
  verifiedEmail: number;
  /** 인증되지 않은 실제 이메일 */
  unverifiedEmail: number;
  userIds: string[];
}

/**
 * 카카오·네이버 계정만 연결돼, 그 로그인을 켜지 않은 운영에서는 들어올 수 없는 사용자를 센다.
 * 읽기만 한다. `scripts/accountRecovery.mjs`의 `social-only` 명령이 쓴다.
 *
 * Cloudflare(D1)에서 옮겨 온 사용자는 카카오·네이버·Google로만 가입했다. 카카오·네이버 로그인을 켜지
 * 않은 운영에서 그 사람들은 들어올 길이 없고, 이메일로 새로 가입하면 빈 계정이 생긴다. 로그인을 다시
 * 켤지, 본인 확인을 마친 한 사람씩 로그인을 더하거나(`addPasswordLogin`) 새 계정으로 데이터를
 * 옮길지(`reassignUserData`) 정하기 전에 몇 명이 막혔는지 본다.
 */
export async function countSocialOnlyUsers(
  db: Db,
  { syntheticEmailDomain }: { syntheticEmailDomain: string },
): Promise<SocialOnlyUsers> {
  const accounts = await db
    .collection(COLLECTIONS.accounts)
    .select("userId", "providerId")
    .get();
  const providersByUser = new Map<string, Set<string>>();
  for (const doc of accounts.docs) {
    const userId: unknown = doc.get("userId");
    if (typeof userId !== "string") continue;
    const providers = providersByUser.get(userId) ?? new Set<string>();
    providers.add(String(doc.get("providerId")));
    providersByUser.set(userId, providers);
  }
  const candidates = [...providersByUser]
    .filter(([, providers]) =>
      [...providers].every((provider) => SOCIAL_ONLY_PROVIDERS.has(provider)),
    )
    .map(([userId]) => userId)
    .filter(isUserId)
    .sort();

  const result: SocialOnlyUsers = {
    total: 0,
    syntheticEmail: 0,
    verifiedEmail: 0,
    unverifiedEmail: 0,
    userIds: [],
  };
  for (const ids of chunkIds(candidates)) {
    const users = await db.getAll(...ids.map((id) => usersCol(db).doc(id)));
    for (const snapshot of users) {
      const user = snapshot.data();
      if (!user) continue;
      result.total += 1;
      result.userIds.push(snapshot.id);
      if (user.email?.endsWith(`@${syntheticEmailDomain}`)) {
        result.syntheticEmail += 1;
      } else if (user.emailVerified) {
        result.verifiedEmail += 1;
      } else {
        result.unverifiedEmail += 1;
      }
    }
  }
  return result;
}

export type AddPasswordLoginResult =
  | {
      status: "ready" | "added";
      userId: string;
      email: string;
      /** 바꾸기 전 이메일. 카카오·네이버가 주지 않아 만든 주소일 수 있다 */
      previousEmail: string | null;
    }
  | { status: "not_found" | "has_password" | "invalid_email" }
  | { status: "not_social_only"; providers: string[] }
  | { status: "email_taken"; heldBy: string };

export type AddPasswordLoginOptions = {
  userId: string;
  email: string;
  now?: Date;
} & (
  | { apply?: false; passwordHash?: undefined }
  | {
      apply: true;
      /** `hashPassword`(Argon2id)로 만든 해시. 비밀번호 원문은 받지 않는다 */
      passwordHash: string;
    }
);

/**
 * 카카오·네이버로만 들어오던 사용자에게 이메일·비밀번호 로그인을 더한다. 계정과 데이터는 그대로라
 * 그 이메일과 비밀번호로 로그인하면 원래 계정으로 들어온다. 본인 확인은 부르는 쪽(운영자)이 먼저
 * 한다. `scripts/accountRecovery.mjs`의 `add-password` 명령이 쓴다.
 *
 * - 사용자의 이메일을 받은 주소(소문자)로 바꾸고 이메일 예약을 옮긴다. 다른 사용자가 그 이메일을
 *   쓰고 있으면(`email_taken`) 아무것도 쓰지 않는다. 이메일 인증 여부는 바꾸지 않는다.
 * - 비밀번호 계정을 Better Auth와 같은 모양(`providerId: "credential"`, `accountId`는 사용자 id)으로
 *   만든다. 이미 비밀번호 계정이 있거나 카카오·네이버가 아닌 로그인이 있으면 막는다.
 * - 읽기를 모두 마친 뒤 한 트랜잭션에서 쓴다. `apply` 없이 부르면 확인만 하고 쓰지 않는다.
 */
export async function addPasswordLogin(
  db: Db,
  options: AddPasswordLoginOptions,
): Promise<AddPasswordLoginResult> {
  const { userId } = options;
  const email = options.email.trim().toLowerCase();
  if (!EmailSchema.safeParse(email).success) return { status: "invalid_email" };
  if (!isUserId(userId)) return { status: "not_found" };
  const now = options.now ?? new Date();

  return db.runTransaction(async (tx): Promise<AddPasswordLoginResult> => {
    const userRef = usersCol(db).doc(userId);
    const reservationRef = userEmailsCol(db).doc(userEmailDocId(email));
    const [userSnapshot, accounts, holders, reservation] = await Promise.all([
      tx.get(userRef),
      tx.get(accountsOf(db, userId)),
      tx.get(usersCol(db).where("email", "==", email)),
      tx.get(reservationRef),
    ]);
    const user = userSnapshot.data();
    if (!user) return { status: "not_found" };
    const providers = [
      ...new Set(accounts.docs.map((doc) => String(doc.get("providerId")))),
    ].sort();
    if (providers.includes("credential")) return { status: "has_password" };
    if (
      providers.length === 0 ||
      providers.some((provider) => !SOCIAL_ONLY_PROVIDERS.has(provider))
    ) {
      return { status: "not_social_only", providers };
    }
    const holder = holders.docs.find((doc) => doc.id !== userId);
    if (holder) return { status: "email_taken", heldBy: holder.id };
    const reservedBy: unknown = reservation.get("userId");
    if (
      typeof reservedBy === "string" &&
      reservedBy !== userId &&
      isUserId(reservedBy) &&
      (await tx.get(usersCol(db).doc(reservedBy))).exists
    ) {
      return { status: "email_taken", heldBy: reservedBy };
    }
    const previousEmail = user.email;
    const oldReservationRef =
      previousEmail !== null && previousEmail !== email
        ? userEmailsCol(db).doc(userEmailDocId(previousEmail))
        : null;
    const oldReservation = oldReservationRef
      ? await tx.get(oldReservationRef)
      : null;
    const planned = { userId, email, previousEmail };
    if (!options.apply) return { status: "ready", ...planned };

    if (previousEmail !== email) tx.update(userRef, { email, updatedAt: now });
    tx.set(reservationRef, { userId });
    if (oldReservationRef && oldReservation?.get("userId") === userId) {
      tx.delete(oldReservationRef);
    }
    const accountId = createId();
    tx.create(db.collection(COLLECTIONS.accounts).doc(accountId), {
      id: accountId,
      accountId: userId,
      providerId: "credential",
      userId,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password: options.passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    return { status: "added", ...planned };
  });
}

/** 다른 계정으로 옮기는(옮긴) 데이터 수 */
export interface ReassignCounts {
  /** 옛 계정의 로그인 세션. 옮기기 전에 끊는다 */
  sessions: number;
  folders: number;
  /** 사본 곡과 함께 옮기는 프레젠테이션 */
  presentations: number;
  libraryDecks: number;
  /** 링크로 들어간 다른 사람의 프레젠테이션 */
  memberships: number;
  tombstones: number;
}

export type ReassignResult =
  | { status: "ready" | "moved"; counts: ReassignCounts }
  | { status: "not_found" | "same_user" };

async function count(query: Query): Promise<number> {
  return (await query.count().get()).data().count;
}

async function countMovable(db: Db, from: string): Promise<ReassignCounts> {
  const [
    sessions,
    folders,
    presentations,
    libraryDecks,
    memberships,
    tombstones,
  ] = await Promise.all([
    count(db.collection(COLLECTIONS.sessions).where("userId", "==", from)),
    count(foldersCol(db).where("userId", "==", from)),
    count(presentationsCol(db).where("userId", "==", from)),
    count(
      decksCol(db)
        .where("userId", "==", from)
        .where("presentationId", "==", null),
    ),
    count(presentationMembersCol(db).where("userId", "==", from)),
    count(
      db.collection(COLLECTIONS.driveTombstones).where("userId", "==", from),
    ),
  ]);
  return {
    sessions,
    folders,
    presentations,
    libraryDecks,
    memberships,
    tombstones,
  };
}

async function refsOf(query: Query): Promise<DocumentReference[]> {
  return (await query.select().get()).docs.map((doc) => doc.ref);
}

async function reassignField(
  db: Db,
  collection: string,
  field: string,
  from: string,
  to: string,
): Promise<number> {
  const refs = await refsOf(db.collection(collection).where(field, "==", from));
  let moved = 0;
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const chunk = refs.slice(i, i + CHUNK_SIZE);
    moved += await db.runTransaction(async (tx) => {
      const current = (await tx.getAll(...chunk)).filter(
        (snapshot) => snapshot.get(field) === from,
      );
      for (const snapshot of current) tx.update(snapshot.ref, { [field]: to });
      return current.length;
    });
  }
  return moved;
}

async function movePresentations(
  db: Db,
  from: string,
  to: string,
): Promise<number> {
  const refs = await refsOf(presentationsCol(db).where("userId", "==", from));
  let moved = 0;
  for (const { id } of refs) {
    moved += await db.runTransaction(async (tx) => {
      const ref = presentationsCol(db).doc(id);
      const toMemberRef = presentationMembersCol(db).doc(memberDocId(id, to));
      const [presentation, copies, toMember] = await Promise.all([
        tx.get(ref),
        tx.get(decksCol(db).where("presentationId", "==", id)),
        tx.get(toMemberRef),
      ]);
      if (presentation.data()?.userId !== from) return 0;
      tx.update(ref, { userId: to });
      for (const copy of copies.docs) {
        const deck = copy.data();
        if (deck.userId !== from) continue;
        tx.update(copy.ref, { userId: to });
      }
      if (toMember.exists) tx.delete(toMemberRef);
      return 1;
    });
  }
  return moved;
}

async function moveDecks(db: Db, from: string, to: string): Promise<number> {
  const ids = (await refsOf(decksCol(db).where("userId", "==", from))).map(
    (ref) => ref.id,
  );
  let moved = 0;
  for (let i = 0; i < ids.length; i += DECK_CHUNK_SIZE) {
    const refs = ids
      .slice(i, i + DECK_CHUNK_SIZE)
      .map((id) => decksCol(db).doc(id));
    moved += await db.runTransaction(async (tx) => {
      const owned = (await tx.getAll(...refs)).filter(
        (snapshot) => snapshot.data()?.userId === from,
      );
      for (const { ref } of owned) tx.update(ref, { userId: to });
      return owned.length;
    });
  }
  return moved;
}

async function moveMemberships(
  db: Db,
  from: string,
  to: string,
): Promise<number> {
  const memberships = await presentationMembersCol(db)
    .where("userId", "==", from)
    .get();
  let moved = 0;
  for (const doc of memberships.docs) {
    const { presentationId } = doc.data();
    moved += await db.runTransaction(async (tx) => {
      const toRef = presentationMembersCol(db).doc(
        memberDocId(presentationId, to),
      );
      const [current, toMember, presentation] = await Promise.all([
        tx.get(doc.ref),
        tx.get(toRef),
        tx.get(presentationsCol(db).doc(presentationId)),
      ]);
      if (!current.exists) return 0;
      tx.delete(doc.ref);
      if (!toMember.exists && presentation.data()?.userId !== to) {
        tx.set(toRef, { presentationId, userId: to });
      }
      return 1;
    });
  }
  return moved;
}

/**
 * 한 사용자의 데이터를 다른 계정으로 옮긴다. 옛 계정으로 들어올 수 없는 사람이 새로 가입한 계정에서
 * 자기 데이터를 다시 쓰게 한다. 본인 확인은 부르는 쪽(운영자)이 먼저 한다. 기본은 미리보기다.
 * `scripts/accountRecovery.mjs`의 `reassign` 명령이 쓴다.
 *
 * - 옛 계정의 로그인 세션을 먼저 끊는다. 이미 로그인한 기기는 세션 쿠키 캐시(5분) 동안 옛 계정에
 *   계속 쓸 수 있으니, 그런 기기가 있으면 5분 뒤 다시 실행해 그사이 생긴 것까지 옮긴다.
 * - 폴더, 프레젠테이션(사본 곡과 한 트랜잭션), 보관함 곡, 링크로 들어간 다른 사람의 프레젠테이션
 *   멤버 기록, 영구 삭제 기록의 사용자 id를 바꾼다. 문서 id는 그대로라 가져온 원본(`forkedFrom`)과
 *   공유 링크는 그대로이고, 곡은 바뀌는 필드만 쓴다.
 * - 묶음마다 다시 읽어 아직 옛 계정의 문서만 쓰므로, 중간에 멈춰도 다시 실행하면 이어서 옮긴다.
 * - 옛 계정 자체(로그인 수단·사용자 문서)는 남긴다. 다 옮긴 뒤 `scripts/deleteUser.mjs`로 지운다.
 */
export async function reassignUserData(
  db: Db,
  {
    fromUserId,
    toUserId,
    apply = false,
  }: { fromUserId: string; toUserId: string; apply?: boolean },
): Promise<ReassignResult> {
  if (fromUserId === toUserId) return { status: "same_user" };
  if (!isUserId(fromUserId) || !isUserId(toUserId)) {
    return { status: "not_found" };
  }
  const [fromUser, toUser] = await Promise.all(
    [fromUserId, toUserId].map(async (id) =>
      (await usersCol(db).doc(id).get()).data(),
    ),
  );
  if (!fromUser || !toUser) return { status: "not_found" };
  if (!apply) {
    return { status: "ready", counts: await countMovable(db, fromUserId) };
  }

  const sessions = await refsOf(
    db.collection(COLLECTIONS.sessions).where("userId", "==", fromUserId),
  );
  await runBulk(db, (writer) => sessions.map((ref) => writer.delete(ref)));
  const move = (collection: string, field: string) =>
    reassignField(db, collection, field, fromUserId, toUserId);
  const folders = await move(COLLECTIONS.folders, "userId");
  const presentations = await movePresentations(db, fromUserId, toUserId);
  const libraryDecks = await moveDecks(db, fromUserId, toUserId);
  const memberships = await moveMemberships(db, fromUserId, toUserId);
  return {
    status: "moved",
    counts: {
      sessions: sessions.length,
      folders,
      presentations,
      libraryDecks,
      memberships,
      tombstones: await move(COLLECTIONS.driveTombstones, "userId"),
    },
  };
}
