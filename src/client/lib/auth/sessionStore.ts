import { useSyncExternalStore } from "react";
import {
  type AuthConfigResponse,
  AuthConfigResponseSchema,
  FALLBACK_USER_NAME,
} from "#shared";
import {
  loadCachedSession,
  saveCachedSession,
  clearCachedSession,
  type SessionUser,
} from "./sessionCache";
import { authClient, type SocialProvider } from "./authClient";
import { AUTH_COPY } from "#copy/auth";

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
      throw new Error(AUTH_COPY.sessionCheckFailed);
    }
    return null;
  }

  const data = result.data;
  if (!data?.user || !data.session) return null;

  return {
    userId: data.user.id,
    name: data.user.name ?? FALLBACK_USER_NAME.default,
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

/**
 * 소셜 로그인 후 원래 보던 주소로 돌아온다. 로그아웃 상태로 공유 링크를
 * 연 사람이 로그인하고 나서 링크로 다시 들어오게 하기 위해서다.
 * 첫 화면(`/`)에서 로그인하면 드라이브로 보낸다.
 */
export async function signInWithProvider(
  provider: SocialProvider,
): Promise<void> {
  const { pathname, search } = window.location;
  await authClient.signIn.social({
    provider,
    callbackURL: pathname === "/" ? "/presentations" : `${pathname}${search}`,
  });
}

export async function fetchAuthConfig(): Promise<AuthConfigResponse> {
  const response = await fetch("/api/auth-config", {
    credentials: "include",
  });
  if (!response.ok) throw new Error(AUTH_COPY.configLoadFailed);
  return AuthConfigResponseSchema.parse(await response.json());
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
