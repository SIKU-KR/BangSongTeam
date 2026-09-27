import { eq } from "drizzle-orm";
import { user } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/** 약관·개인정보 동의 시각. 동의 전이거나 사용자가 없으면 null이다. */
export async function getTermsAgreedAt(
  db: DbInstance,
  userId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ termsAgreedAt: user.termsAgreedAt })
    .from(user)
    .where(eq(user.id, userId));
  return row?.termsAgreedAt ?? null;
}

/**
 * 약관·개인정보 동의를 기록한다.
 *
 * 처음 동의한 시각을 증빙으로 남기려고 이미 동의한 사용자는 덮어쓰지 않는다.
 */
export async function agreeToTerms(
  db: DbInstance,
  userId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const existing = await getTermsAgreedAt(db, userId);
  if (existing) return existing;

  const [row] = await db
    .update(user)
    .set({ termsAgreedAt: now })
    .where(eq(user.id, userId))
    .returning({ termsAgreedAt: user.termsAgreedAt });
  return row?.termsAgreedAt ?? null;
}
