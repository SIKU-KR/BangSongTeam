import type { Db } from "../client";
import { signUpQuotaDocId, signUpQuotasCol } from "../collections";

/**
 * IP 하나(IPv6는 /64 대역)에서 하루에 받는 이메일 가입 수. 교회 와이파이 하나로 팀 전체가 같은 날
 * 가입해도 닿지 않을 만큼 둔다.
 */
export const DAILY_SIGN_UPS_PER_IP = 20;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const QUOTA_RETENTION_MS = 2 * DAY_MS;

/** 하루 한도를 세는 날: 한국 시간 날짜(YYYY-MM-DD). 사용자에게 '내일'은 한국 시간 0시부터다 */
export function quotaDay(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function quotaExpiresAt(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000+09:00`) + QUOTA_RETENTION_MS);
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
