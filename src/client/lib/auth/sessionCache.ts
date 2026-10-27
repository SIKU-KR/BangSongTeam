import { SessionEndReasonSchema, type SessionEndReason } from "#shared";
import { getOfflineDB, type CachedSession } from "../storage/db";

const CURRENT_KEY = "current" as const;
const SESSION_END_KEY = "chiton:session-end";
const SIGN_OUT_PENDING_KEY = "chiton:sign-out-pending";

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

/**
 * 계정이 끝나 새로고침하기 직전에 그 이유를 이 탭에 남긴다. 다음 부팅(`takeSessionEnd`)은 캐시된
 * 세션을 믿기 전에 서버에 먼저 묻고, 만료였으면 로그인 화면에서 그렇게 알린다.
 *
 * sessionStorage는 탭마다 따로이고 새로고침해도 남는다. localStorage에 두면 다른 탭의 부팅까지
 * 이 탭의 이유를 따른다. 저장소를 쓸 수 없으면 남기지 않고 보통 부팅으로 둔다.
 */
export function rememberSessionEnd(reason: SessionEndReason): void {
  try {
    window.sessionStorage.setItem(SESSION_END_KEY, reason);
  } catch {
    return;
  }
}

/**
 * 서버가 아직 확인하지 않은 로그아웃을 이 브라우저에 남긴다. 남겼으면 true, 저장소를 쓸 수
 * 없으면 false다.
 *
 * 세션 쿠키는 HttpOnly라 서버의 로그아웃 응답만 지운다. 오프라인이거나 서버가 답하지 않은 채
 * 로그아웃하면 쿠키와 서버 세션이 그대로 남아, 다음에 이 브라우저를 여는 사람이 앞 사람의
 * 계정으로 들어간다. 그래서 이 표시가 있는 동안에는 캐시된 세션도 쿠키의 세션도 믿지 않고 먼저
 * 로그아웃을 마친다. 쿠키는 모든 탭과 다음 방문이 함께 쓰므로 sessionStorage가 아니라
 * localStorage에 둔다. 값은 남긴 시각이다.
 */
export function markSignOutPending(): boolean {
  try {
    window.localStorage.setItem(SIGN_OUT_PENDING_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** 마치지 못한 로그아웃이 남아 있는지. 저장소를 읽을 수 없으면 남은 것이 없다고 본다 */
export function hasPendingSignOut(): boolean {
  try {
    return window.localStorage.getItem(SIGN_OUT_PENDING_KEY) !== null;
  } catch {
    return false;
  }
}

/** 서버가 로그아웃을 확인했거나 이메일로 새로 로그인해 쿠키가 바뀌었을 때 표시를 지운다 */
export function clearPendingSignOut(): void {
  try {
    window.localStorage.removeItem(SIGN_OUT_PENDING_KEY);
  } catch {
    return;
  }
}

/** 남긴 이유를 읽고 지운다. 없거나 읽을 수 없거나 모르는 값이면 null이다 */
export function takeSessionEnd(): SessionEndReason | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_END_KEY);
    if (raw === null) return null;
    window.sessionStorage.removeItem(SESSION_END_KEY);
    const parsed = SessionEndReasonSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
