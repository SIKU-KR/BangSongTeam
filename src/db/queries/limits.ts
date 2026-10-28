import type { Transaction } from "@google-cloud/firestore";
import type { Db } from "../client";
import {
  signUpQuotaDocId,
  signUpQuotasCol,
  userQuotaDocId,
  userQuotasCol,
  usersCol,
  type UserDoc,
} from "../collections";

/**
 * 사용자 한 명이 하루(한국 시간)에 할 수 있는 공유 라이브러리 쓰기 수. 넘으면 다음 날 0시까지 그
 * 일만 막는다.
 *
 * 한 사람이 스크립트로 공유 라이브러리를 곡으로 덮거나 가져간 횟수를 부풀리거나 신고로 운영자를
 * 덮지 못하게 하는 한도다. 한 주에 몇 곡을 올리는 찬양 인도자는 닿지 않는다. 보관함을 한꺼번에
 * 공개하는 사람도 하루 이틀이면 끝나고, 새 팀이 여러 프레젠테이션을 한 번에 채워도 가져오기는
 * 막히지 않는다(이미 가져온 곡은 세지 않는다).
 */
export const DAILY_USER_LIMITS = {
  publish: 30,
  fork: 200,
  report: 30,
} as const;

export type UserQuotaAction = keyof typeof DAILY_USER_LIMITS;

/**
 * IP 하나(IPv6는 /64 대역)에서 하루에 받는 이메일 가입 수. 교회 와이파이 하나로 팀 전체가 같은 날
 * 가입해도 닿지 않을 만큼 둔다.
 */
export const DAILY_SIGN_UPS_PER_IP = 20;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const QUOTA_RETENTION_MS = 2 * DAY_MS;

/**
 * 운영자가 제한한 계정인지(`UserDoc.bannedAt`). 이 필드가 생기기 전에 만든 사용자 문서는 필드가
 * 없어 제한되지 않은 것으로 읽는다.
 */
export function isBannedUser(
  user: Pick<UserDoc, "bannedAt"> | undefined,
): boolean {
  return Boolean(user?.bannedAt);
}

/** 하루 한도를 세는 날: 한국 시간 날짜(YYYY-MM-DD). 사용자에게 '내일'은 한국 시간 0시부터다 */
export function quotaDay(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function quotaExpiresAt(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000+09:00`) + QUOTA_RETENTION_MS);
}

/** 트랜잭션에서 읽어 둔 하루 한도 */
export interface PreparedQuota {
  /** 그날 한도를 이미 다 썼다 */
  exceeded: boolean;
  /** 한 번 센다. 트랜잭션의 읽기를 모두 마친 뒤 쓰기 단계에서 부른다 */
  take: () => void;
}

/**
 * 사용자의 그날 한도를 트랜잭션에서 읽는다. 다른 읽기와 함께 먼저 부르고, 그 일을 하기로 했을 때만
 * `take`를 부른다. 같은 트랜잭션이라 동시에 와도 한도보다 많이 받지 않는다.
 */
export async function prepareUserQuota(
  tx: Transaction,
  db: Db,
  userId: string,
  action: UserQuotaAction,
  now: Date,
): Promise<PreparedQuota> {
  const day = quotaDay(now);
  const ref = userQuotasCol(db).doc(userQuotaDocId(userId, day));
  const stored = (await tx.get(ref)).data();
  const counts = {
    publish: stored?.publish ?? 0,
    fork: stored?.fork ?? 0,
    report: stored?.report ?? 0,
  };
  return {
    exceeded: counts[action] >= DAILY_USER_LIMITS[action],
    take: () => {
      tx.set(ref, {
        userId,
        day,
        ...counts,
        [action]: counts[action] + 1,
        expiresAt: quotaExpiresAt(day),
      });
    },
  };
}

/** 공유 라이브러리에 쓰는 사람의 계정 제한과 그날 한도 */
export interface LibraryLimits {
  banned: boolean;
  quota: PreparedQuota;
}

/** 계정 제한(`isBannedUser`)과 그날 한도(`prepareUserQuota`)를 트랜잭션에서 함께 읽는다 */
export async function readLibraryLimits(
  tx: Transaction,
  db: Db,
  userId: string,
  action: UserQuotaAction,
  now: Date,
): Promise<LibraryLimits> {
  const [user, quota] = await Promise.all([
    tx.get(usersCol(db).doc(userId)).then((snapshot) => snapshot.data()),
    prepareUserQuota(tx, db, userId, action, now),
  ]);
  return { banned: isBannedUser(user), quota };
}

/**
 * 이메일 가입 하나를 그 IP 키의 그날 수에 센다. 한도(`DAILY_SIGN_UPS_PER_IP`)를 이미 다 썼으면 세지
 * 않고 `false`다. 키는 IP를 해시한 값이라 IP는 남지 않는다.
 */
export async function takeSignUpQuota(
  db: Db,
  key: string,
  now: Date = new Date(),
): Promise<boolean> {
  const day = quotaDay(now);
  const ref = signUpQuotasCol(db).doc(signUpQuotaDocId(key, day));
  return db.runTransaction(async (tx) => {
    const signUps = (await tx.get(ref)).data()?.signUps ?? 0;
    if (signUps >= DAILY_SIGN_UPS_PER_IP) return false;
    tx.set(ref, {
      day,
      signUps: signUps + 1,
      expiresAt: quotaExpiresAt(day),
    });
    return true;
  });
}
