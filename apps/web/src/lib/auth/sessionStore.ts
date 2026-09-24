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

export type SessionFetcher = () => Promise<SessionUser | null>;

const fetchFromServer: SessionFetcher = async () => {
  const result = await authClient.getSession();
  if (result.error) {
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

export function getCurrentUserId(): string | null {
  return state.user?.userId ?? null;
}

/** 앱 초기화 시 캐시된 세션 또는 서버 세션 복원 */
export async function hydrateSession(): Promise<SessionState> {
  let cached: SessionUser | null = null;
  try {
    cached = await loadCachedSession();
  } catch {
    cached = null;
  }

  if (cached) {
    setState({ status: "authenticated", user: cached });
    void revalidateSession();
    return state;
  }

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

export async function revalidateSession(): Promise<void> {
  let user: SessionUser | null;
  try {
    user = await fetcher();
  } catch {
    return;
  }

  if (user) {
    await persist(user);
    setState({ status: "authenticated", user });
    return;
  }

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

export async function signInAsDeveloper(email?: string): Promise<void> {
  const response = await fetch("/api/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(email ? { email } : {}),
  });

  if (!response.ok) {
    throw new Error("개발자 로그인에 실패했습니다");
  }

  await revalidateSession();
}

export async function fetchAuthConfig(): Promise<{
  providers: SocialProvider[];
  devLogin: boolean;
}> {
  const response = await fetch("/api/auth-config", {
    credentials: "include",
  });
  if (!response.ok) throw new Error("로그인 설정을 읽지 못했습니다");
  return (await response.json()) as {
    providers: SocialProvider[];
    devLogin: boolean;
  };
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    await forget();
    setState({ status: "unauthenticated", user: null });
  }
}

async function persist(user: SessionUser): Promise<void> {
  try {
    await saveCachedSession(user);
  } catch (error) {
    void error;
  }
}

async function forget(): Promise<void> {
  try {
    await clearCachedSession();
  } catch (error) {
    void error;
  }
}

export function __setSessionFetcherForTests(next: SessionFetcher | null): void {
  fetcher = next ?? fetchFromServer;
}

export function __setSessionForTests(user: SessionUser | null): void {
  setState(
    user
      ? { status: "authenticated", user }
      : { status: "unauthenticated", user: null },
  );
}

export function __resetSessionForTests(): void {
  fetcher = fetchFromServer;
  setState({ status: "loading", user: null });
}
