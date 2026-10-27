import type { DocumentData, DocumentReference } from "@google-cloud/firestore";
import type { Db } from "../client";
import {
  COLLECTIONS,
  userEmailDocId,
  userEmailsCol,
  usersCol,
  type UserDoc,
} from "../collections";

/**
 * 반쯤 끝난 이메일 가입으로 보고 치우기 전에 기다리는 시간. 사용자 문서를 만든 뒤 비밀번호
 * 계정을 저장하기 전인 진행 중의 가입을 지우지 않으려는 여유다.
 */
export const ABANDONED_SIGN_UP_MIN_AGE_MS = 60_000;

/** 같은 이메일의 사용자가 이미 있어 사용자 문서를 만들지 않았다 */
export class EmailTakenError extends Error {
  constructor() {
    super("A user with this email already exists");
    this.name = "EmailTakenError";
  }
}

/**
 * 이메일을 예약하며 사용자 문서를 만든다. 예약이 가리키는 사용자가 있으면
 * `EmailTakenError`로 실패하고 아무것도 쓰지 않는다.
 *
 * 같은 이메일로 동시에 가입하면 둘 다 Better Auth의 이메일 조회를 통과해 사용자가 둘 생기고,
 * 로그인은 둘 중 하나로만 이어져 다른 쪽 데이터가 보이지 않게 된다. 예약 읽기와 두 쓰기를 한
 * 트랜잭션에 묶어 먼저 커밋한 요청만 사용자를 만든다.
 */
export async function createUserWithEmail(
  db: Db,
  userRef: DocumentReference,
  email: string,
  data: DocumentData,
): Promise<void> {
  const reservationRef = userEmailsCol(db).doc(userEmailDocId(email));
  await db.runTransaction(async (tx) => {
    const holderId: unknown = (await tx.get(reservationRef)).get("userId");
    if (typeof holderId === "string") {
      const holder = await tx.get(usersCol(db).doc(holderId));
      if (holder.exists) throw new EmailTakenError();
    }
    tx.set(reservationRef, { userId: userRef.id });
    tx.create(userRef, data);
  });
}

/** 지울 사용자들이 가진 이메일 예약. 같은 이메일을 다른 사용자가 가졌으면 남긴다 */
export async function reservationsHeldBy(
  db: Db,
  users: readonly { id?: unknown; email?: unknown }[],
): Promise<DocumentReference[]> {
  const refs = users.flatMap((user) =>
    typeof user.email === "string"
      ? [userEmailsCol(db).doc(userEmailDocId(user.email))]
      : [],
  );
  if (refs.length === 0) return [];
  const ids = new Set(users.map((user) => user.id));
  const snapshots = await db.getAll(...refs);
  return snapshots
    .filter((snapshot) => ids.has(snapshot.get("userId")))
    .map((snapshot) => snapshot.ref);
}

function looksAbandoned(user: UserDoc | undefined, now: Date): boolean {
  if (!user || user.emailVerified || user.termsAgreedAt) return false;
  const createdAt =
    user.createdAt instanceof Date ? user.createdAt.getTime() : now.getTime();
  return now.getTime() - createdAt >= ABANDONED_SIGN_UP_MIN_AGE_MS;
}

/**
 * 반쯤 끝난 이메일 가입을 치워 그 이메일로 다시 가입할 수 있게 한다. 치웠으면 `true`.
 *
 * Better Auth 가입은 사용자 문서와 비밀번호 계정을 따로 쓴다. 그 사이에 저장이 실패하면
 * 비밀번호 없는 사용자만 남아, 같은 이메일로는 가입도(이미 있음) 로그인도(비밀번호 없음)
 * 못 한다. 그래서 가입 요청마다 그 이메일의 사용자가 아래를 모두 만족하면 지운다.
 * - 이메일의 사용자가 하나뿐이다.
 * - 연결된 계정(비밀번호·소셜)이 없어 누구도 로그인할 수 없다.
 * - 이메일이 인증되지 않았고 약관에 동의하지 않았다. 앱을 써 본 적 없는 사용자다.
 * - 만든 지 `ABANDONED_SIGN_UP_MIN_AGE_MS`가 지났다. 만든 시각을 모르면 방금 만든 것으로 본다.
 *
 * 마지막 확인과 지우기는 한 트랜잭션에서 하고, 이메일 예약은 아직 그 사용자를 가리킬 때만
 * 지운다. 같은 이메일로 둘이 동시에 가입하면, 먼저 치운 쪽이 새 사용자와 예약을 만든 뒤에 늦은
 * 쪽이 지우기를 마칠 수 있다. 미리 읽어 둔 대로 지우면 그 새 예약까지 지워, 그 이메일로 사용자가
 * 다시 둘 생길 수 있다.
 */
export async function releaseAbandonedSignUp(
  db: Db,
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  const users = await usersCol(db)
    .where("email", "==", email.toLowerCase())
    .limit(2)
    .get();
  const [candidate] = users.docs;
  if (users.size !== 1 || !candidate) return false;
  if (!looksAbandoned(candidate.data(), now)) return false;

  const reservationRef = userEmailsCol(db).doc(userEmailDocId(email));
  const accounts = db
    .collection(COLLECTIONS.accounts)
    .where("userId", "==", candidate.id)
    .limit(1);
  return await db.runTransaction(async (tx) => {
    const user = await tx.get(candidate.ref);
    const reservation = await tx.get(reservationRef);
    const linked = await tx.get(accounts);
    if (!looksAbandoned(user.data(), now) || !linked.empty) return false;
    tx.delete(candidate.ref);
    if (reservation.data()?.userId === candidate.id) {
      tx.delete(reservationRef);
    }
    return true;
  });
}
