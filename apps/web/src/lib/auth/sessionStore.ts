import { useSyncExternalStore } from "react";
import {
  loadCachedSession,
  saveCachedSession,
  clearCachedSession,
  type SessionUser,
} from "./sessionCache";
import { authClient, type SocialProvider } from "./authClient";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
}

/**
 * 서버에 현재 세션을 묻는다.
 *
 * 반환 규약이 중요하다:
 * - 세션 있음 → SessionUser
 * - 세션 없음(서버가 확실히 답함) → null
 * - **네트워크에 닿지 못함 → throw**
 *
 * 오프라인을 '세션 없음'으로 뭉뚱그리면 예배 당일 네트워크가 끊기는 순간
 * 로그아웃되어 송출이 멈춘다.
 */
export type SessionFetcher = () => Promise<SessionUser | null>;

const fetchFromServer: SessionFetcher = async () => {
  const result = await authClient.getSession();
  if (result.error) {
    // better-auth는 네트워크 실패도 error로 준다. 상태 코드가 있으면
    // 서버가 답한 것이고, 없으면 닿지 못한 것이다.
    if (result.error.status === undefined) {
      throw new Error("세션 확인 실패: 서버에 닿지 못했습니다");
    }
    return null;
  }

  const data = result.data;
  if (!data?.user || !data.session) return null;

  return {
    userId: data.user.id,
    name: data.user.name ?? "사용자",
    image: data.user.image ?? null,
    expiresAt: new Date(data.session.expiresAt).getTime(),
  };
};

let state: SessionState = { status: "loading", user: null };
let fetcher: SessionFetcher = fetchFromServer;
const listeners = new Set<() => void>();

function setState(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionState(): SessionState {
  return state;
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSessionState, getSessionState);
}

/** 현재 로그인한 사용자 id (미인증이면 null) */
export function getCurrentUserId(): string | null {
  return state.user?.userId ?? null;
}

/**
 * 부팅 시 1회 실행.
 *
 * **캐시를 먼저 보고 즉시 결론을 낸다.** 서버 확인을 기다리면 네트워크가 느리거나
 * 끊긴 상황에서 예배 시작이 그만큼 늦어지고, 최악에는 로그인 화면이 뜬다.
 * 서버 재검증은 백그라운드로 돌려 결과가 다르면 그때 상태를 고친다.
 */
export async function hydrateSession(): Promise<SessionState> {
  let cached: SessionUser | null = null;
  try {
    cached = await loadCachedSession();
  } catch {
    // 저장소를 못 쓰는 환경이면 서버 확인으로 넘어간다
    cached = null;
  }

  if (cached) {
    setState({ status: "authenticated", user: cached });
    void revalidateSession();
    return state;
  }

  // 캐시가 없으면 서버에 물어야 한다. 여기서 실패하면(오프라인 + 캐시 없음)
  // 할 수 있는 게 없으므로 미인증으로 내린다.
  try {
    const user = await fetcher();
    if (user) {
      await persist(user);
      setState({ status: "authenticated", user });
    } else {
      setState({ status: "unauthenticated", user: null });
    }
  } catch {
    setState({ status: "unauthenticated", user: null });
  }

  return state;
}

/**
 * 서버와 세션 상태를 맞춘다 (백그라운드).
 *
 * 네트워크 실패는 상태를 건드리지 않는다. 그게 오프라인 송출을 지탱한다.
 */
export async function revalidateSession(): Promise<void> {
  let user: SessionUser | null;
  try {
    user = await fetcher();
  } catch {
    return; // 오프라인 — 캐시된 세션을 그대로 유지한다
  }

  if (user) {
    await persist(user);
    setState({ status: "authenticated", user });
    return;
  }

  // 서버가 '세션 없음'을 확실히 답했다 (만료·로그아웃됨)
  await forget();
  setState({ status: "unauthenticated", user: null });
}

export async function signInWithProvider(
  provider: SocialProvider,
): Promise<void> {
  await authClient.signIn.social({
    provider,
    callbackURL: "/presentations",
  });
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    // 서버 로그아웃이 실패해도 로컬 세션은 반드시 내린다.
    await forget();
    setState({ status: "unauthenticated", user: null });
  }
}

async function persist(user: SessionUser): Promise<void> {
  try {
    await saveCachedSession(user);
  } catch {
    // 캐시 실패는 로그인 자체를 막지 않는다 (다음 부팅에 서버로 확인한다)
  }
}

async function forget(): Promise<void> {
  try {
    await clearCachedSession();
  } catch {
    // 무시
  }
}

/**
 * 테스트 전용: 세션 조회기를 갈아 끼운다.
 *
 * 상태는 건드리지 않는다. 한 테스트 안에서 온라인 → 오프라인 전환을 흉내 내려면
 * 조회기만 바꿔야 하고, 여기서 상태까지 초기화하면 그 시나리오를 쓸 수 없다.
 */
export function __setSessionFetcherForTests(next: SessionFetcher | null): void {
  fetcher = next ?? fetchFromServer;
}

/**
 * 테스트 전용: 로그인 상태를 즉시 세팅한다.
 *
 * 스토어 단위 테스트는 `hydrateSession()`을 거치지 않으므로, 조회기만
 * 바꿔서는 `getCurrentUserId()`가 여전히 null이다.
 */
export function __setSessionForTests(user: SessionUser | null): void {
  setState(
    user
      ? { status: "authenticated", user }
      : { status: "unauthenticated", user: null },
  );
}

/** 테스트 전용: 스토어 상태를 초기화한다 */
export function __resetSessionForTests(): void {
  fetcher = fetchFromServer;
  setState({ status: "loading", user: null });
}
