import { useSyncExternalStore } from "react";
import {
  AuthSessionResponseSchema,
  AuthSignOutResponseSchema,
  DAILY_SIGN_UP_LIMIT_CODE,
  FALLBACK_USER_NAME,
  SessionBroadcastSchema,
  type EmailSignUpRequest,
  type SessionBroadcast,
  type SessionEndReason,
} from "#shared";
import {
  loadCachedSession,
  saveCachedSession,
  clearCachedSession,
  clearPendingSignOut,
  hasPendingSignOut,
  markSignOutPending,
  rememberSessionEnd,
  takeSessionEnd,
  type SessionUser,
} from "./sessionCache";
import { authClient, type SocialProvider } from "./authClient";
import { isProjectionPath } from "../../features/presentation/fullscreen";
import {
  clearPersistenceError,
  reportPersistenceError,
} from "../storage/persistenceStatus";
import { createBroadcast, type Broadcast } from "../browser/broadcast";
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
const SIGN_OUT_TIMEOUT_MS = 5000;
const EMAIL_AUTH_TIMEOUT_MS = 20_000;
const SOCIAL_SIGN_IN_TIMEOUT_MS = 20_000;
const SESSION_CHANNEL = "chiton:session";

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
let changedElsewhere = false;
let checkDeferred = false;
let accountEndReason: SessionEndReason | null = null;
let leaving: Promise<void> | null = null;
let hydration: Promise<SessionState> | null = null;
let revalidation: Promise<void> | null = null;
let finishing: Promise<boolean> | null = null;
let otherTabs: Broadcast<SessionBroadcast> | null = null;
let acceptedSignIn: string | null = null;

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
 * 송출 화면을 떠났을 때 부른다. 송출 중에 계정이 끝났으면 미뤄 둔 새로고침을 지금 하고, 송출
 * 중에 미뤄 둔 세션 확인(`requestSessionCheck`)이 있으면 지금 한 번 한다. 송출 중이거나 미뤄 둔
 * 일이 없으면 아무것도 하지 않는다.
 *
 * 계정이 끝나면(로그아웃·세션 만료·다른 계정·다른 탭의 로그인 변화) 세 큐를 끄고 저장본 쓰기를
 * 마친 뒤 새로고침한다. 새로고침이 앞 계정의 메모리 큐·타이머·실패 기록·스토어를 모두 비우고,
 * 다음 부팅이 누가 로그인했는지 정한다. 송출 중이면 큐만 끄고 세션 상태와 epoch는 그대로 둔다.
 * 송출 화면을 다시 그리거나 송출 화면의 부팅을 버리면 관객 화면이 끊긴다.
 *
 * 송출 화면 밖에서 시작한 새로고침은 끝까지 한다. 로딩 화면이 이미 송출 화면을 내렸으므로,
 * 그사이 뒤로 가기로 주소가 송출 화면으로 바뀌었다고 미루면 탭이 로딩 화면에 멈춘다.
 */
export function resumeDeferredSessionWork(): void {
  if (isProjecting()) return;
  if (accountEndReason !== null) {
    checkDeferred = false;
    void finishLeaving(accountEndReason);
    return;
  }
  if (!checkDeferred) return;
  checkDeferred = false;
  requestSessionCheck();
}

/**
 * 동기화 요청이 401(세션 거절)이나 403(다른 계정의 문서)을 받았을 때 부른다. 서버에 세션을 다시
 * 물어(`revalidateSession`) 세션이 없으면 만료로, 다른 사용자면 계정 전환으로 계정을 끝낸다.
 *
 * 401 하나로 곧바로 로그아웃하지 않는다. 엔드포인트 하나나 프록시 하나가 401을 내도 세션은 살아
 * 있을 수 있어서, 부팅처럼 get-session으로 확인한 결과만 따른다. 확인하지 못하면(오프라인·5xx)
 * 그대로 두고 큐가 재시도 한도 안에서 다시 보낸다. 403은 다른 탭에서 계정이 바뀐 낡은 탭이 받는다.
 *
 * 로그인한 탭에서만, 한 번에 하나만 묻는다. 로그아웃·로그인 중이거나 계정이 이미 끝났으면
 * 아무것도 하지 않는다. 송출 중이면 묻지 않고 송출을 마칠 때까지 미룬다(`resumeDeferredSessionWork`).
 * 송출 중에는 요청이 0건이어야 한다.
 */
export function requestSessionCheck(): void {
  if (
    state.status !== "authenticated" ||
    transitioning ||
    accountEndReason !== null
  ) {
    return;
  }
  if (isProjecting()) {
    checkDeferred = true;
    return;
  }
  void revalidateSession();
}

/**
 * 같은 브라우저의 다른 탭이 알리는 로그인 변화를 듣는다(`chiton:session`). 돌려준 함수로 끈다.
 * `App`이 세션을 복원하기 전에 켠다.
 *
 * 탭들은 쿠키와 IndexedDB의 세션 캐시를 함께 쓴다. 다른 탭에서 로그아웃하거나 다른 계정으로
 * 로그인하면 이 탭의 큐가 다음 계정의 쿠키로 앞 계정의 문서를 올린다. 그래서 알림을 받으면:
 *
 * - 로그아웃·로그인 중이면 표시만 남긴다(`signOut`이 보고 서버에 알리지 않거나 캐시를 지우지 않는다).
 * - 같은 사용자로 로그인한 탭과 로그인하지 않은 탭은 그대로 둔다. 로그인하지 않은 탭에는 계정
 *   상태가 없고, 공유 링크를 보던 손님을 새 계정으로 들이면 안 된다.
 * - 그 밖에는(다른 사용자, 아직 부팅 중인 탭) 로그아웃 알림이면 세션 캐시를 먼저 지우고 계정을
 *   끝낸다(`otherTab`). 부팅 중인 탭은 바뀌기 전의 캐시를 이미 읽었을 수 있다. 캐시를 지우는 것은
 *   이 탭의 늦은 세션 확인이 보낸 탭이 지운 뒤에 앞 계정을 다시 썼을 수 있어서다.
 *
 * 알린 사용자를 그대로 쓰지는 않는다. 새로고침한 부팅이 서버에 물어 정한다. 이 탭이 일으킨
 * 변화(로그아웃·이메일 로그인·세션 확인 결과)와, 서버에 물은 부팅이 캐시와 다른 사용자나 끝난 세션을
 * 찾은 것을 알린다(`hydrateSession`). 받은 알림과 캐시와 같은 사용자로 들어간 부팅은 알리지 않는다.
 * 알림을 받고 새로고침한 탭의 부팅은 보낸 탭이 남긴 캐시와 서버의 답이 같아 다시 알리지 않는다.
 * `BroadcastChannel`이 없으면 다음 동기화 요청의 401·403 확인이나 다른 계정의 목록을 받은 부팅
 * 동기화의 세션 확인으로 따라간다.
 */
export function listenToOtherTabs(): () => void {
  otherTabs?.close();
  const channel = createBroadcast(SESSION_CHANNEL, SessionBroadcastSchema);
  otherTabs = channel;
  channel.subscribe(followOtherTab);
  return () => {
    channel.close();
    if (otherTabs === channel) otherTabs = null;
  };
}

function announce(userId: string | null): void {
  otherTabs?.post({ userId });
}

function otherTabChanged(): boolean {
  return changedElsewhere;
}

function followOtherTab({ userId }: SessionBroadcast): void {
  if (transitioning) {
    changedElsewhere = true;
    return;
  }
  if (state.status === "unauthenticated") return;
  if (state.status === "authenticated" && state.user?.userId === userId) {
    return;
  }
  void (async (): Promise<void> => {
    if (userId === null) await forget();
    if (accountEndReason !== null) return;
    await leaveAccount("otherTab");
  })();
}

/**
 * 앱 초기화 시 캐시된 세션 또는 서버 세션을 복원한다. 겹쳐 불러도 한 번만 복원한다.
 *
 * - 서버가 확인하지 않은 로그아웃이 남아 있으면(`hasPendingSignOut`) 무엇보다 먼저 캐시를 지우고,
 *   로그아웃을 마치러 보내고(`finishPendingSignOut`), 로그인하지 않은 상태로 둔다. 캐시도 쿠키의
 *   세션도 로그아웃한 사람의 것이다. 마무리를 기다리지 않고 로그인 화면을 그린다. 송출 화면에서는
 *   보내지 않는다.
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
 * - 서버에 물어 캐시와 다른 사용자로 들어가거나(소셜 로그인으로 돌아온 부팅 포함) 캐시의 세션이
 *   끝난 것을 찾으면 다른 탭에 알린다(`listenToOtherTabs`). 이 탭이 일으킨 변화가 아니어도 알리지
 *   않으면, 앞 계정을 띄운 채 숨어 있던 탭이 다음 요청까지 바뀐 쿠키로 다른 계정의 목록을 받는다.
 * - 그사이 로그인·로그아웃·계정 끝내기가 시작되면(epoch) 결과를 캐시에도 상태에도 쓰지 않는다.
 * - 캐시를 읽지 못하면(다른 탭에 막힌 저장소 등) 캐시가 없는 것처럼 이어 가되, 세션 캐시의 저장
 *   실패로 알린다. 로그인 화면으로 끝나도 경고 배너가 까닭을 보이고, 캐시를 다시 저장하면 지운다.
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
  if (hasPendingSignOut()) {
    await forget();
    if (!isProjecting()) void finishPendingSignOut();
    if (started !== epoch) return state;
    setState(signedOutState(false));
    return state;
  }

  let cached: SessionUser | null = null;
  try {
    cached = await loadCachedSession();
  } catch (err) {
    reportPersistenceError(err, "session");
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
    if (user.userId !== cached?.userId) announce(user.userId);
    return state;
  }

  if (cached) await forget();
  if (started !== epoch) return state;
  setState(
    signedOutState(
      endReason === "expired" || (cached !== null && endReason !== "signedOut"),
    ),
  );
  if (cached) announce(null);
  return state;
}

/**
 * 서버에 세션을 다시 확인한다. 한 번에 하나만 보낸다.
 *
 * - 세션이 없으면 캐시를 지우고, 다른 탭에 로그아웃을 알리고, 계정을 끝낸다(`expired`).
 * - 다른 사용자면 그 사용자를 캐시에 남기고, 다른 탭에 알리고, 계정을 끝낸다(`switched`).
 *   제자리에서 바꾸면 앞 계정의 큐·스토어가 남아 다음 쿠키로 올라간다.
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
    announce(null);
    await leaveAccount("expired");
    return;
  }

  await persist(user);
  if (!isStillSignedIn(started)) return;
  if (user.userId !== state.user?.userId) {
    announce(user.userId);
    await leaveAccount("switched");
    return;
  }
  setState({ status: "authenticated", user });
}

async function requestSignOut(): Promise<boolean> {
  try {
    const { data, error } = await authClient.signOut({
      fetchOptions: { signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS) },
    });
    return error === null && AuthSignOutResponseSchema.safeParse(data).success;
  } catch {
    return false;
  }
}

/**
 * 서버가 확인하지 않은 로그아웃(`markSignOutPending`)을 마친다. 마쳤거나 남은 로그아웃이 없으면
 * true다. 한 번에 하나만 보낸다.
 *
 * 부팅, 연결 회복(`App`이 `subscribeSyncRecovery`에 붙인다), 소셜 로그인 직전에 부른다. 교회 PC의
 * 탭이 열린 채로 남아도 연결이 돌아오면 남은 쿠키와 서버 세션을 지운다. 서버의 로그아웃은 쿠키가
 * 없어도 성공으로 답하므로 여러 번 보내도 된다.
 *
 * 로그인·로그아웃 중에는 보내지 않고 false다. 로그인 중에 보내면 늦게 온 로그아웃 응답의 쿠키
 * 만료가 방금 로그인한 새 세션의 쿠키를 지운다. 로그아웃 중에는 그 로그아웃이 이미 보내고 있다.
 */
export function finishPendingSignOut(): Promise<boolean> {
  if (!hasPendingSignOut()) return Promise.resolve(true);
  if (transitioning) return Promise.resolve(false);
  finishing ??= (async (): Promise<boolean> => {
    const confirmed = await requestSignOut();
    if (confirmed) clearPendingSignOut();
    return confirmed;
  })().finally(() => {
    finishing = null;
  });
  return finishing;
}

/**
 * 소셜 로그인을 시작하지 못했다. `message`는 화면에 그대로 보여 줄 안내 문구다. 화면은 이 오류의
 * 문구만 그대로 보이고, 서버에 닿지 못한 오류 같은 나머지는 일반 안내로 바꾼다.
 */
export class SocialSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialSignInError";
  }
}

/**
 * 소셜 로그인 후 원래 보던 주소로 돌아온다. 로그아웃 상태로 공유 링크를
 * 연 사람이 로그인하고 나서 링크로 다시 들어오게 하기 위해서다.
 * 첫 화면(`/`)에서 로그인하면 드라이브로 보낸다.
 *
 * 도중에 실패해도 같은 주소로 돌아온다(`errorCallbackURL`). 알려 주지 않으면 Better Auth가 자기
 * 오류 주소로 보내, 운영에서는 이유를 알 수 없는 랜딩 화면으로, 개발에서는 영문 오류 페이지로
 * 떨어진다. 돌아온 로그인 화면이 `?error=코드`를 읽어 안내한다(`callbackErrorMessage`).
 *
 * better-auth 클라이언트는 실패를 던지지 않고 `error`로 돌려준다. 그대로 두면
 * 이동도 오류도 없이 버튼이 로딩 상태로 멈추므로 던져서 화면이 안내하게 한다. 서버에 등록되지
 * 않은 프로바이더(404)는 다시 시도해도 같으므로 다른 방법으로 로그인하라고 따로 안내한다.
 * 같은 까닭으로 시작 요청은 20초까지만 기다리고 끊어 던진다. 느린 교회 Wi‑Fi에서 응답 없이 멈춘
 * 요청을 기다리기만 하면, 로그인 화면은 이메일 로그인과 돌아가기 버튼까지 막은 채 새로고침할
 * 때까지 풀지 않는다.
 *
 * 서버가 확인하지 않은 로그아웃이 남아 있으면 먼저 마치고, 마치지 못하면 로그인을 시작하지 않는다.
 * 그대로 시작하면 돌아온 부팅이 남은 표시를 보고 방금 로그인한 세션을 로그아웃시키고, 늦게 온
 * 로그아웃 응답이 새 쿠키를 지울 수도 있다.
 */
export async function signInWithProvider(
  provider: SocialProvider,
): Promise<void> {
  if (!(await finishPendingSignOut())) {
    throw new SocialSignInError(AUTH_COPY.signInFailed);
  }
  const { pathname, search } = window.location;
  const returnPath =
    pathname === "/" ? "/presentations" : `${pathname}${search}`;
  const { error } = await authClient.signIn.social({
    provider,
    callbackURL: returnPath,
    errorCallbackURL: returnPath,
    fetchOptions: { signal: AbortSignal.timeout(SOCIAL_SIGN_IN_TIMEOUT_MS) },
  });
  if (error) {
    throw new SocialSignInError(
      error.status === 404
        ? AUTH_COPY.providerUnavailable
        : AUTH_COPY.signInFailed,
    );
  }
}

export type EmailAuthFailure =
  | "invalidCredentials"
  | "alreadyExists"
  | "invalidInput"
  | "rateLimited"
  | "dailySignUpLimit"
  | "network"
  | "unknown";

/** 이메일 로그인·가입 실패. 화면 문구는 `reason`으로 고른다. */
export class EmailAuthError extends Error {
  constructor(readonly reason: EmailAuthFailure) {
    super(reason);
    this.name = "EmailAuthError";
  }
}

interface EmailAuthRejection {
  status?: number;
  code?: string;
}

function failureFromStatus(status: number | undefined): EmailAuthFailure {
  switch (status) {
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

function signUpFailure(error: EmailAuthRejection): EmailAuthFailure {
  if (error.status === 422) {
    return error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
      ? "alreadyExists"
      : "unknown";
  }
  if (error.status === 429 && error.code === DAILY_SIGN_UP_LIMIT_CODE) {
    return "dailySignUpLimit";
  }
  return failureFromStatus(error.status);
}

async function signInThen(
  email: string,
  send: (signal: AbortSignal) => Promise<{ error: EmailAuthRejection | null }>,
  failureOf: (error: EmailAuthRejection) => EmailAuthFailure,
): Promise<void> {
  const account = email.trim().toLowerCase();
  transitioning = true;
  epoch += 1;
  try {
    if (finishing) await finishing;
    if (acceptedSignIn !== account) {
      acceptedSignIn = null;
      let result: { error: EmailAuthRejection | null };
      try {
        result = await send(AbortSignal.timeout(EMAIL_AUTH_TIMEOUT_MS));
      } catch {
        throw new EmailAuthError("network");
      }
      if (result.error) throw new EmailAuthError(failureOf(result.error));
      clearPendingSignOut();
      acceptedSignIn = account;
    }
    await adoptSignedInSession();
  } finally {
    transitioning = false;
    changedElsewhere = false;
  }
}

async function adoptSignedInSession(): Promise<void> {
  const started = epoch;
  let user: SessionUser | null;
  try {
    user = await fetcher(FIRST_SESSION_CHECK_TIMEOUT_MS);
  } catch {
    if (started !== epoch) return;
    throw new EmailAuthError("network");
  }
  if (started !== epoch) return;
  acceptedSignIn = null;
  if (!user) throw new EmailAuthError("unknown");

  await persist(user);
  if (started !== epoch) return;
  setState({ status: "authenticated", user });
  announce(user.userId);
}

/**
 * 이메일·비밀번호로 로그인한다. 성공하면 서버 세션으로 세션 스토어를 갱신하고 다른 탭에 알린다.
 *
 * 새로고침 없이 그 자리에서 들어간다. 계정이 끝나면 늘 새로고침하므로 로그인 화면을 보이는
 * 페이지에는 다른 계정의 큐·스토어가 남아 있지 않다. 그사이 시작된 세션 확인의 늦은 결과가
 * 새 세션을 덮지 않게 epoch를 올린다.
 *
 * 요청은 20초, 들어온 뒤의 세션 확인은 첫 로그인처럼 15초까지 기다린다. 느린 교회 Wi‑Fi에서
 * 캐시 확인용 5초로 자르면 로그인은 됐는데 화면이 그대로 남는다. 서버에 닿지 못하거나 세션을
 * 확인하지 못하면 `network`, 들어온 뒤 서버가 세션이 없다고 하면 `unknown`으로 던져 화면이
 * 알리게 한다. 확인하지 못한 로그인을 조용히 넘기면 사용자는 비밀번호가 틀린 줄 알고 다시 보낸다.
 *
 * 서버가 받아 준 뒤 세션 확인만 실패했으면(`network`), 같은 이메일(대소문자 무시)로 다시 부를 때
 * 자격 증명은 보내지 않고 세션만 다시 확인한다. 쿠키에는 이미 받아 준 세션이 있어, 다시 보내면
 * 로그인은 서버 세션을 하나 더 만들고 가입은 방금 만든 계정을 이미 가입한 이메일(422)로 거절한다.
 * 그사이 다른 이메일로 보냈거나 서버가 세션이 없다고 답했으면 다시 보낸다.
 *
 * 서버가 확인하지 않은 로그아웃(`finishPendingSignOut`)이 보내는 중이면 끝난 뒤에 보낸다. 늦게 온
 * 로그아웃 응답이 새 쿠키를 지우면 안 된다. 로그인에 성공하면 쿠키가 새 세션으로 바뀌었으므로
 * 남은 로그아웃 표시를 지운다.
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  await signInThen(
    email,
    (signal) =>
      authClient.signIn.email({ email, password, fetchOptions: { signal } }),
    (error) => failureFromStatus(error.status),
  );
}

/**
 * 이메일·비밀번호로 가입한다. 메일 인증이 없어 가입과 동시에 로그인된다(`signInWithEmail`처럼
 * 그 자리에서 들어가고, 시간 제한·실패 안내·남은 로그아웃 표시와 세션 확인만 다시 하는 것도 같다).
 * 같은 이메일로 이미 가입했으면 `alreadyExists`로 던진다. 서버가 사용자를 만들지 못한
 * 422(`FAILED_TO_CREATE_USER`: 저장 실패, 같은 이메일로 동시에 보낸 가입)와 같은 이메일의 가입이
 * 아직 끝나지 않았다는 409(`SIGN_UP_IN_PROGRESS`)는 `unknown`이라 잠시 뒤 다시 가입하게 한다.
 * 이미 가입했다고 안내하면 사용자는 그 이메일로 로그인하려 하지만 들어가지 못한다.
 * IP 하나의 하루 가입 한도에 닿은 429(`DAILY_SIGN_UP_LIMIT_CODE`)는 `dailySignUpLimit`이다. 이 한도는
 * 한국 시간 0시에야 풀려, 잠시 후 다시 시도하라는 빈도 제한 안내(`rateLimited`)를 따르면 계속 실패한다.
 */
export async function signUpWithEmail(
  input: EmailSignUpRequest,
): Promise<void> {
  await signInThen(
    input.email,
    (signal) => authClient.signUp.email({ ...input, fetchOptions: { signal } }),
    signUpFailure,
  );
}

/**
 * 로그아웃한다. 대기 중인 저장과 변경을 먼저 보내고(`flushBeforeSignOut`), 서버에 로그아웃을
 * 알리고, 캐시를 지우고, 다른 탭에 알린 뒤 계정을 끝낸다(`signedOut`). 로그아웃 중이거나 계정이
 * 이미 끝났으면 아무것도 하지 않는다.
 *
 * 보내기는 쿠키가 아직 유효할 때 한다. 로그아웃 뒤의 요청은 401로 버려진다. 시작하자마자 epoch를
 * 올려, 그 전에 시작한 세션 확인이 늦게 끝나며 지운 캐시에 이 계정을 다시 쓰지 않게 한다.
 *
 * 세션 쿠키는 서버의 로그아웃 응답만 지운다. 서버가 5초 안에 `{ success: true }`로 확인해야
 * 로그아웃이 끝난 것으로 본다. 확인하지 않으면(오프라인·5xx·응답 없음) 요청 전에 남긴 표시
 * (`markSignOutPending`)로 다음 부팅·연결 회복·소셜 로그인 전에 마저 끝내고, 이 탭은 로그아웃한다.
 * 표시도 남길 수 없으면 아무것도 바꾸지 않고 `AUTH_COPY.signOutFailed`로 던진다. 쿠키가 남은 채
 * 로그인 화면을 보이면 공용 PC의 다음 사람이 앞 사람의 계정으로 들어간다.
 *
 * 그사이 다른 탭의 로그인 변화를 받았으면(`listenToOtherTabs`) 따른다. 보내는 동안 받았으면 서버에
 * 알리지 않고 그 탭을 따라 계정을 끝낸다(`otherTab`). 지금 쿠키는 다른 탭이 로그인한 계정일 수
 * 있다. 서버에 알리는 동안 받았으면 캐시를 지우지 않는다. 다른 탭이 남긴 세션 캐시다.
 */
export async function signOut(): Promise<void> {
  if (transitioning || accountEndReason !== null) return;
  transitioning = true;
  epoch += 1;
  try {
    await hooks?.flushBeforeSignOut().catch(() => undefined);
    if (otherTabChanged()) {
      await leaveAccount("otherTab");
      return;
    }
    const marked = markSignOutPending();
    const confirmed = await requestSignOut();
    if (confirmed) clearPendingSignOut();
    else if (!marked) throw new Error(AUTH_COPY.signOutFailed);
    if (!otherTabChanged()) await forget();
    announce(null);
    await leaveAccount("signedOut");
  } finally {
    transitioning = false;
    changedElsewhere = false;
  }
}

async function persist(user: SessionUser): Promise<void> {
  try {
    await saveCachedSession(user);
    clearPersistenceError("session");
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
  changedElsewhere = false;
  checkDeferred = false;
  otherTabs?.close();
  otherTabs = null;
  accountEndReason = null;
  leaving = null;
  hydration = null;
  revalidation = null;
  finishing = null;
  acceptedSignIn = null;
  takeSessionEnd();
  clearPendingSignOut();
  setState({ status: "loading", user: null });
}
