import { getOfflineDB, type CachedSession } from "../storage/db";

const CURRENT_KEY = "current" as const;

/** 오프라인 캐시 세션 사용자 정보 */
export interface SessionUser {
  userId: string;
  name: string;
  image?: string | null;
  expiresAt: number;
}

/** 인증 세션을 IndexedDB에 캐시 */
export async function saveCachedSession(user: SessionUser): Promise<void> {
  const db = await getOfflineDB();
  const record: CachedSession = {
    id: CURRENT_KEY,
    userId: user.userId,
    name: user.name,
    image: user.image ?? null,
    expiresAt: user.expiresAt,
    cachedAt: Date.now(),
  };
  await db.put("auth_session", record);
}

/** 만료되지 않은 캐시 세션 조회 */
export async function loadCachedSession(): Promise<SessionUser | null> {
  const db = await getOfflineDB();
  const record = await db.get("auth_session", CURRENT_KEY);
  if (!record) return null;

  if (record.expiresAt <= Date.now()) {
    await db.delete("auth_session", CURRENT_KEY);
    return null;
  }

  return {
    userId: record.userId,
    name: record.name,
    image: record.image,
    expiresAt: record.expiresAt,
  };
}

/** 캐시된 세션 삭제 */
export async function clearCachedSession(): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("auth_session", CURRENT_KEY);
}
