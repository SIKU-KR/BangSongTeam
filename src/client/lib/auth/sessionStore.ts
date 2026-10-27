import { useSyncExternalStore } from "react";
import {
  AuthSessionResponseSchema,
  FALLBACK_USER_NAME,
  type EmailSignUpRequest,
  type SessionEndReason,
} from "#shared";
import {
  loadCachedSession,
  saveCachedSession,
  clearCachedSession,
  rememberSessionEnd,
  takeSessionEnd,
  type SessionUser,
} from "./sessionCache";
import { authClient, type SocialProvider } from "./authClient";
import { isProjectionPath } from "../../features/presentation/fullscreen";
import { AUTH_COPY } from "#copy/auth";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  reason?: "expired";
}

/**
 * 서버가 "세션 없음"이라고 분명히 답할 때(401, 또는 200에 `null`)만 null을 돌려준다.
 * better-auth의 get-session은 403을 내지 않으므로 403은 교회·회사 프록시나 WAF가 보낸
 * 응답으로 보고, 5xx·429·캡티브 포털 응답·시간 초과와 함께 던진다. 호출자는 던짐을
 * "확인하지 못함"으로 보고 로그인 상태를 지키므로, 서버가 잠깐 아파도 예배 중에 로그아웃되지 않는다.
 */
export type SessionFetcher = (timeoutMs: number) => Promise<SessionUser | null>;

/**
 * 계정이 끝날 때 동기화 쪽이 할 일. `App`이 `lib/sync`의 구현을 등록한다(`setAccountHooks`).
 * 이 모듈이 `lib/sync`를 가져오면 lib/sync → features/presentation → 이 모듈로 순환이 생긴다.
 */
export interface AccountHooks {
  /** 로그아웃 요청 전, 쿠키가 아직 유효할 때 대기 중인 저장과 변경을 보낸다 */
  flushBeforeSignOut(): Promise<void>;
  /** 세 동기화 큐를 곧바로 끄고 저장본 쓰기를 마친다 */
  stopAccountSync(): Promise<void>;
}

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

const reloadWindow = (): void => window.location.reload();

let state: SessionState = { status: "loading", user: null };
let fetcher: SessionFetcher = fetchFromServer;
const listeners = new Set<() => void>();
let hooks: AccountHooks | null = null;
let pageReload: () => void = reloadWindow;
let epoch = 0;
let transitioning = false;
let accountEndReason: SessionEndReason | null = null;
let leaving: Promise<void> | null = null;
let hydration: Promise<SessionState> | null = null;
let revalidation: Promise<void> | null = null;

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

/** 계정이 끝날 때 부를 동기화 쪽 일을 등록한다. `App`이 부팅할 때 등록하고 내릴 때 푼다 */
export function setAccountHooks(next: AccountHooks | null): void {
  hooks = next;
}

function signedOutState(expired: boolean): SessionState {
  return expired
    ? { status: "unauthenticated", user: null, reason: "expired" }
    : { status: "unauthenticated", user: null };
}

function isProjecting(): boolean {
  return isProjectionPath(window.location.pathname);
}

function stopAccountSync(): Promise<void> {
  return hooks?.stopAccountSync().catch(() => undefined) ?? Promise.resolve();
}

function leaveAccount(reason: SessionEndReason): Promise<void> {
  accountEndReason ??= reason;
  if (isProjecting()) {
    void stopAccountSync();
    return Promise.resolve();
  }
  return finishLeaving(accountEndReason);
}

function finishLeaving(reason: SessionEndReason): Promise<void> {
  leaving ??= (async (): Promise<void> => {
    epoch += 1;
    const stopping = stopAccountSync();
    setState({ status: "loading", user: null });
    await stopping;
    rememberSessionEnd(reason);
    pageReload();
  })();
  return leaving;
}

/**
 * 송출 화면을 떠났을 때 부른다. 송출 중에 계정이 끝났으면 미뤄 둔 새로고침을 지금 한다. 송출
 * 중이거나 미뤄 둔 일이 없으면 아무것도 하지 않는다.
 *
 * 계정이 끝나면(로그아웃·세션 만료·다른 계정) 세 큐를 끄고 저장본 쓰기를 마친 뒤 새로고침한다.
 * 새로고침이 앞 계정의 메모리 큐·타이머·실패 기록·스토어를 모두 비우고, 다음 부팅이 누가
 * 로그인했는지 정한다. 송출 중이면 큐만 끄고 세션 상태와 epoch는 그대로 둔다. 송출 화면을 다시
 * 그리거나 송출 화면의 부팅을 버리면 관객 화면이 끊긴다.
 *
 * 송출 화면 밖에서 시작한 새로고침은 끝까지 한다. 로딩 화면이 이미 송출 화면을 내렸으므로,
 * 그사이 뒤로 가기로 주소가 송출 화면으로 바뀌었다고 미루면 탭이 로딩 화면에 멈춘다.
 */
export function resumeDeferredSessionWork(): void {
  if (accountEndReason === null || isProjecting()) return;
  void finishLeaving(accountEndReason);
}

/**
 * 앱 초기화 시 캐시된 세션 또는 서버 세션을 복원한다. 겹쳐 불러도 한 번만 복원한다.
 *
 * - 유효한 캐시는 서버를 기다리지 않고 통과시킨다.
 * - 송출 화면에서 부팅했으면 캐시가 만료됐어도 통과시키고 서버에 묻지 않는다. 송출 중
 *   새로고침이 서버 요청을 만들거나, 응답을 기다리며 검은 화면을 늘리거나, 로그아웃으로
 *   화면을 바꾸면 안 된다.
 * - 계정이 끝나 새로고침한 부팅(`takeSessionEnd`)은 유효한 캐시도 만료된 캐시처럼 서버에 먼저
 *   묻는다. 캐시에 끝난 계정이 남아 있을 수 있다(늦게 끝난 재검증, 실패한 캐시 쓰기). 빠른 길로
 *   들어가면 그 계정으로 화면을 그리고, 오프라인이면 그대로 머문다. 캐시를 다시 쓰지 못하는
 *   브라우저에서 계정 전환 → 새로고침이 끝없이 되풀이되지 않게도 한다.
 * - 만료된 캐시는 서버에 물어본다. 서버에 닿지 못하면 캐시된 사용자로 들어간다.
 *   일주일에 한 번 쓰는 노트북이 오프라인 예배당에서 송출하지 못하게 되는 것을 막기 위해서다.
 *   데이터는 이미 이 기기에 있고, 서버 API는 서버 세션으로 따로 막힌다.
 * - 캐시가 없으면(로그인 직후) 돌아갈 사용자가 없으므로 느린 회선에서도 로그인이
 *   끊기지 않게 서버를 더 오래 기다린다.
 * - 서버가 세션 없음을 분명히 답하면 캐시를 지우고 로그아웃한다. 캐시된 세션이 있었거나 세션
 *   만료로 끝난 부팅이면 `reason: "expired"`를 붙여 로그인 화면이 만료를 알리게 한다. 로그아웃으로
 *   끝난 부팅은 붙이지 않는다.
 * - 그사이 로그인·로그아웃·계정 끝내기가 시작되면(epoch) 결과를 캐시에도 상태에도 쓰지 않는다.
 */
export function hydrateSession(): Promise<SessionState> {
  if (hydration) return hydration;
  const running = restoreSession().finally(() => {
    if (hydration === running) hydration = null;
  });
  hydration = running;
  return running;
}

async function restoreSession(): Promise<SessionState> {
  const started = epoch;
  const endReason = takeSessionEnd();
  let cached: SessionUser | null = null;
  try {
    cached = await loadCachedSession();
  } catch {
    cached = null;
  }
  if (started !== epoch) return state;

  const isProjection = isProjecting();
  if (
    cached &&
    (isProjection || (endReason === null && cached.expiresAt > Date.now()))
  ) {
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
    if (started !== epoch) return state;
    setState(
      cached
        ? { status: "authenticated", user: cached }
        : signedOutState(endReason === "expired"),
    );
    return state;
  }
  if (started !== epoch) return state;

  if (user) {
    await persist(user);
    if (started !== epoch) return state;
    setState({ status: "authenticated", user });
    return state;
  }

  if (cached) await forget();
  if (started !== epoch) return state;
  setState(
    signedOutState(
      endReason === "expired" || (cached !== null && endReason !== "signedOut"),
    ),
  );
  return state;
}

/**
 * 서버에 세션을 다시 확인한다. 한 번에 하나만 보낸다.
 *
 * - 세션이 없으면 캐시를 지우고 계정을 끝낸다(`expired`).
 * - 다른 사용자면 그 사용자를 캐시에 남기고 계정을 끝낸다(`switched`). 제자리에서 바꾸면 앞
 *   계정의 큐·스토어가 남아 다음 쿠키로 올라간다.
 * - 같은 사용자면 만료 시각을 갱신한다. 확인하지 못하면(오프라인·5xx) 아무것도 하지 않는다.
 *
 * 결과는 그사이 로그아웃·로그인이 시작됐거나(epoch), 계정이 이미 끝났거나, 로그인 상태가 아니면
 * 버린다. 캐시 쓰기도 결과다. 로그아웃이 캐시를 지운 뒤 늦은 확인이 앞 계정을 다시 쓰면 다음
 * 부팅이 그 계정으로 들어간다.
 */
export function revalidateSession(): Promise<void> {
  if (revalidation) return revalidation;
  const running = checkSession().finally(() => {
    if (revalidation === running) revalidation = null;
  });
  revalidation = running;
  return running;
}

function isStillSignedIn(started: number): boolean {
  return (
    started === epoch &&
    accountEndReason === null &&
    state.status === "authenticated"
  );
}

async function checkSession(): Promise<void> {
  const started = epoch;
  let user: SessionUser | null;
  try {
    user = await fetcher(CACHED_SESSION_CHECK_TIMEOUT_MS);
  } catch {
    return;
  }
  if (!isStillSignedIn(started)) return;

  if (!user) {
    await forget();
    if (!isStillSignedIn(started)) return;
    await leaveAccount("expired");
    return;
  }

  await persist(user);
  if (!isStillSignedIn(started)) return;
  if (user.userId !== state.user?.userId) {
    await leaveAccount("switched");
    return;
  }
  setState({ status: "authenticated", user });
}

/**
 * 소셜 로그인 후 원래 보던 주소로 돌아온다. 로그아웃 상태로 공유 링크를
 * 연 사람이 로그인하고 나서 링크로 다시 들어오게 하기 위해서다.
 * 첫 화면(`/`)에서 로그인하면 드라이브로 보낸다.
 *
 * better-auth 클라이언트는 실패를 던지지 않고 `error`로 돌려준다. 그대로 두면
 * 이동도 오류도 없이 버튼이 로딩 상태로 멈추므로 던져서 화면이 안내하게 한다.
 */
export async function signInWithProvider(
  provider: SocialProvider,
): Promise<void> {
  const { pathname, search } = window.location;
  const { error } = await authClient.signIn.social({
    provider,
    callbackURL: pathname === "/" ? "/presentations" : `${pathname}${search}`,
  });
  if (error) throw new Error(AUTH_COPY.signInFailed);
}

export type EmailAuthFailure =
  | "invalidCredentials"
  | "alreadyExists"
  | "invalidInput"
  | "rateLimited"
  | "network"
  | "unknown";

/** 이메일 로그인·가입 실패. 화면 문구는 `reason`으로 고른다. */
export class EmailAuthError extends Error {
  constructor(readonly reason: EmailAuthFailure) {
    super(reason);
    this.name = "EmailAuthError";
  }
}

function failureFromStatus(status: number | undefined): EmailAuthFailure {
  switch (status) {
    case undefined:
    case 0:
      return "network";
    case 400:
      return "invalidInput";
    case 401:
      return "invalidCredentials";
    case 422:
      return "alreadyExists";
    case 429:
      return "rateLimited";
    default:
      return "unknown";
  }
}

function signUpFailure(error: {
  status?: number;
  code?: string;
}): EmailAuthFailure {
  if (error.status === 422) {
    return error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
      ? "alreadyExists"
      : "unknown";
  }
  return failureFromStatus(error.status);
}

async function signInThen(request: () => Promise<void>): Promise<void> {
  transitioning = true;
  epoch += 1;
  try {
    await request();
    await adoptSignedInSession();
  } finally {
    transitioning = false;
  }
}

async function adoptSignedInSession(): Promise<void> {
  const started = epoch;
  let user: SessionUser | null;
  try {
    user = await fetcher(CACHED_SESSION_CHECK_TIMEOUT_MS);
  } catch {
    return;
  }
  if (started !== epoch) return;

  if (!user) {
    await forget();
    if (started !== epoch) return;
    setState(signedOutState(false));
    return;
  }

  await persist(user);
  if (started !== epoch) return;
  setState({ status: "authenticated", user });
}

/**
 * 이메일·비밀번호로 로그인한다. 성공하면 서버 세션으로 세션 스토어를 갱신한다.
 *
 * 새로고침 없이 그 자리에서 들어간다. 계정이 끝나면 늘 새로고침하므로 로그인 화면을 보이는
 * 페이지에는 다른 계정의 큐·스토어가 남아 있지 않다. 그사이 시작된 세션 확인의 늦은 결과가
 * 새 세션을 덮지 않게 epoch를 올린다.
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  await signInThen(async () => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new EmailAuthError(failureFromStatus(error.status));
  });
}

/**
 * 이메일·비밀번호로 가입한다. 메일 인증이 없어 가입과 동시에 로그인된다(`signInWithEmail`처럼
 * 그 자리에서 들어간다).
 * 같은 이메일로 이미 가입했으면 `alreadyExists`로 던진다. 서버가 사용자를 만들지 못한
 * 422(`FAILED_TO_CREATE_USER`: 저장 실패, 같은 이메일로 동시에 보낸 가입)와 같은 이메일의 가입이
 * 아직 끝나지 않았다는 409(`SIGN_UP_IN_PROGRESS`)는 `unknown`이라 잠시 뒤 다시 가입하게 한다.
 * 이미 가입했다고 안내하면 사용자는 그 이메일로 로그인하려 하지만 들어가지 못한다.
 */
export async function signUpWithEmail(
  input: EmailSignUpRequest,
): Promise<void> {
  await signInThen(async () => {
    const { error } = await authClient.signUp.email(input);
    if (error) throw new EmailAuthError(signUpFailure(error));
  });
}

/**
 * 로그아웃한다. 대기 중인 저장과 변경을 먼저 보내고(`flushBeforeSignOut`), 서버에 로그아웃을
 * 알리고, 캐시를 지운 뒤 계정을 끝낸다(`signedOut`). 로그아웃 중이거나 계정이 이미 끝났으면
 * 아무것도 하지 않는다.
 *
 * 보내기는 쿠키가 아직 유효할 때 한다. 로그아웃 뒤의 요청은 401로 버려진다. 시작하자마자 epoch를
 * 올려, 그 전에 시작한 세션 확인이 늦게 끝나며 지운 캐시에 이 계정을 다시 쓰지 않게 한다. 서버에
 * 알리지 못해도 이 탭은 로그아웃한다. 공용 PC에서 다음 사람에게 계정이 남으면 안 된다.
 */
export async function signOut(): Promise<void> {
  if (transitioning || accountEndReason !== null) return;
  transitioning = true;
  epoch += 1;
  try {
    await hooks?.flushBeforeSignOut().catch(() => undefined);
    await authClient.signOut().catch(() => undefined);
    await forget();
    await leaveAccount("signedOut");
  } finally {
    transitioning = false;
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

/** 테스트 전용: jsdom은 `location.reload`를 구현하지 않아, 계정이 끝날 때의 새로고침을 바꾼다 */
export function __setPageReloadForTests(next: (() => void) | null): void {
  pageReload = next ?? reloadWindow;
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
  hooks = null;
  pageReload = reloadWindow;
  epoch += 1;
  transitioning = false;
  accountEndReason = null;
  leaving = null;
  hydration = null;
  revalidation = null;
  takeSessionEnd();
  setState({ status: "loading", user: null });
}
