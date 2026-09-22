import { getOfflineDB, type CachedSession } from "../storage/db";

const CURRENT_KEY = "current" as const;

export interface SessionUser {
  userId: string;
  name: string;
  image?: string | null;
  /** epoch ms */
  expiresAt: number;
}

/**
 * 마지막으로 서버가 확인해 준 세션을 저장한다.
 *
 * 세션 쿠키는 httpOnly라 JS가 못 읽는다. 이 캐시가 없으면 부팅할 때마다
 * 서버에 물어야 하고, 예배 당일 네트워크가 끊기면 로그인 화면으로 튕긴다.
 */
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

/** 만료되지 않은 캐시 세션을 읽는다 */
export async function loadCachedSession(): Promise<SessionUser | null> {
  const db = await getOfflineDB();
  const record = await db.get("auth_session", CURRENT_KEY);
  if (!record) return null;

  // 만료된 세션으로 게이트를 통과시키면 서버 요청마다 401이 나면서도
  // 화면은 로그인된 것처럼 보이는 어정쩡한 상태가 된다.
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
