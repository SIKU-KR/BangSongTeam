import { useSyncExternalStore } from "react";
import {
  type AuthConfigResponse,
  AuthConfigResponseSchema,
  AuthSessionResponseSchema,
  FALLBACK_USER_NAME,
} from "#shared";
import {
  loadCachedSession,
  saveCachedSession,
  clearCachedSession,
  type SessionUser,
} from "./sessionCache";
import { authClient, type SocialProvider } from "./authClient";
import { isProjectionPath } from "../../features/presentation/fullscreen";
import { AUTH_COPY } from "#copy/auth";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
}

/**
 * 서버가 "세션 없음"이라고 분명히 답할 때(401, 또는 200에 `null`)만 null을 돌려준다.
 * better-auth의 get-session은 403을 내지 않으므로 403은 교회·회사 프록시나 WAF가 보낸
 * 응답으로 보고, 5xx·429·캡티브 포털 응답·시간 초과와 함께 던진다. 호출자는 던짐을
 * "확인하지 못함"으로 보고 로그인 상태를 지키므로, 서버가 잠깐 아파도 예배 중에 로그아웃되지 않는다.
 */
export type SessionFetcher = (timeoutMs: number) => Promise<SessionUser | null>;

const CACHED_SESSION_CHECK_TIMEOUT_MS = 5000;
const FIRST_SESSION_CHECK_TIMEOUT_MS = 15000;

const fetchFromServer: SessionFetcher = async (timeoutMs) => {
  const result = await authClient.getSession({
    fetchOptions: { signal: AbortSignal.timeout(timeoutMs) },
  });
  if (result.error) {
    if (result.error.status === 401) return null;
    throw new Error(AUTH_COPY.sessionCheckFailed);
  }

  if (result.data === null) return null;

  const parsed = AuthSessionResponseSchema.safeParse(result.data);
  if (!parsed.success) throw new Error(AUTH_COPY.sessionCheckFailed);

  const { user, session } = parsed.data;
  return {
    userId: user.id,
    name: user.name ?? FALLBACK_USER_NAME.default,
    image: user.image ?? null,
    expiresAt: session.expiresAt.getTime(),
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

/**
 * 앱 초기화 시 캐시된 세션 또는 서버 세션을 복원한다.
 *
 * - 유효한 캐시는 서버를 기다리지 않고 통과시킨다.
 * - 송출 화면에서 부팅했으면 캐시가 만료됐어도 통과시키고 서버에 묻지 않는다. 송출 중
 *   새로고침이 서버 요청을 만들거나, 응답을 기다리며 검은 화면을 늘리거나, 로그아웃으로
 *   화면을 바꾸면 안 된다.
 * - 만료된 캐시는 서버에 물어본다. 서버에 닿지 못하면 캐시된 사용자로 들어간다.
 *   일주일에 한 번 쓰는 노트북이 오프라인 예배당에서 송출하지 못하게 되는 것을 막기 위해서다.
 *   데이터는 이미 이 기기에 있고, 서버 API는 서버 세션으로 따로 막힌다.
 * - 캐시가 없으면(로그인 직후) 돌아갈 사용자가 없으므로 느린 회선에서도 로그인이
 *   끊기지 않게 서버를 더 오래 기다린다.
 * - 서버가 세션 없음을 분명히 답하면 캐시를 지우고 로그아웃한다.
 */
export async function hydrateSession(): Promise<SessionState> {
  let cached: SessionUser | null = null;
  try {
    cached = await loadCachedSession();
  } catch {
    cached = null;
  }

  const isProjection = isProjectionPath(window.location.pathname);
  if (cached && (isProjection || cached.expiresAt > Date.now())) {
    setState({ status: "authenticated", user: cached });
    if (!isProjection) void revalidateSession();
    return state;
  }

  let user: SessionUser | null;
  try {
    user = await fetcher(
      cached ? CACHED_SESSION_CHECK_TIMEOUT_MS : FIRST_SESSION_CHECK_TIMEOUT_MS,
    );
  } catch {
    setState(
      cached
        ? { status: "authenticated", user: cached }
        : { status: "unauthenticated", user: null },
    );
    return state;
  }

  if (user) {
    await persist(user);
    setState({ status: "authenticated", user });
  } else {
    if (cached) await forget();
    setState({ status: "unauthenticated", user: null });
  }

  return state;
}

export async function revalidateSession(): Promise<void> {
  let user: SessionUser | null;
  try {
    user = await fetcher(CACHED_SESSION_CHECK_TIMEOUT_MS);
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
