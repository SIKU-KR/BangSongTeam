import { getOfflineDB, type CachedSession } from "../storage/db";

const CURRENT_KEY = "current" as const;

export interface SessionUser {
  userId: string;
  name: string;
  image?: string | null;
  expiresAt: number;
}

export async function saveCachedSession(user: SessionUser): Promise<void> {
  const db = await getOfflineDB();
  const record: CachedSession = {
    id: CURRENT_KEY,
    userId: user.userId,
    name: user.name,
    image: user.image ?? null,
    expiresAt: user.expiresAt,
  };
  await db.put("auth_session", record);
}

/**
 * 만료된 기록도 지우지 않고 돌려준다. 오프라인에서는 만료된 세션이라도 송출할 수 있어야 해서,
 * 만료 여부와 그때 서버에 물을지는 `hydrateSession`이 판단한다.
 */
export async function loadCachedSession(): Promise<SessionUser | null> {
  const db = await getOfflineDB();
  const record = await db.get("auth_session", CURRENT_KEY);
  if (!record) return null;

  return {
    userId: record.userId,
    name: record.name,
    image: record.image,
    expiresAt: record.expiresAt,
  };
}

export async function clearCachedSession(): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("auth_session", CURRENT_KEY);
}
