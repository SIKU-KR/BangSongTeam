import type { Db } from "../client";
import { usersCol } from "../collections";

/** 약관·개인정보 동의 시각. 동의 전이거나 사용자가 없으면 null이다. */
export async function getTermsAgreedAt(
  db: Db,
  userId: string,
): Promise<Date | null> {
  const user = (await usersCol(db).doc(userId).get()).data();
  return user?.termsAgreedAt ?? null;
}

/**
 * 약관·개인정보 동의를 기록한다.
 *
 * 처음 동의한 시각을 증빙으로 남기려고 이미 동의한 사용자는 덮어쓰지 않는다.
 */
export async function agreeToTerms(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  return db.runTransaction(async (tx) => {
    const ref = usersCol(db).doc(userId);
    const user = (await tx.get(ref)).data();
    if (!user) return null;
    if (user.termsAgreedAt) return user.termsAgreedAt;

    tx.update(ref, { termsAgreedAt: now });
    return now;
  });
}
