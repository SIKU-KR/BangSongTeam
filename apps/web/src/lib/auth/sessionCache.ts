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
    cachedAt: Date.now(),
  };
  await db.put("auth_session", record);
}

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

export async function clearCachedSession(): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("auth_session", CURRENT_KEY);
}
