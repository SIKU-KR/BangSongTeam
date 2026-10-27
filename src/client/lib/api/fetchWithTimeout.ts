/**
 * 네트워크 호출 데드라인(Timeout) 및 시그널 합성 유틸리티.
 *
 * 브라우저→Worker 요청이 응답 없이 멈추는 현상(죽은 HTTP/2 연결, Wi-Fi 불안정)을
 * 방지하기 위해 모든 요청에 요청 단위의 데드라인을 부여한다.
 */

import { onlyItem } from "#shared";
import {
  createTraceContext,
  rememberRequestMeta,
  toRoutePattern,
  type RequestMeta,
} from "./traceContext";

const TRACEPARENT_HEADER = "traceparent";

function traceIdOf(traceparent: string | null): string | undefined {
  return /^00-([0-9a-f]{32})-/.exec(traceparent ?? "")?.[1];
}

export const DEFAULT_API_TIMEOUT_MS = 10_000;
export const PULL_API_TIMEOUT_MS = 30_000;
/** 연결 회복 확인 요청은 짧게 끊는다. 멈춘 연결에서 10초를 기다리면 회복이 그만큼 늦다 */
export const HEALTH_API_TIMEOUT_MS = 5_000;
/**
 * 폴더·프레젠테이션 영구 삭제의 데드라인. 큰 폴더는 서버가 트랜잭션을 여러 번 나눠 지워 10초를
 * 넘길 수 있다. 그 전에 끊으면 서버는 삭제를 끝내는데 화면은 오프라인이라 지우지 못했다고 알린다.
 * Cloudflare가 원 서버 응답을 기다리는 100초보다는 짧다.
 */
export const DELETE_API_TIMEOUT_MS = 60_000;

/**
 * 페이지가 숨겨진 동안 keepalive로 보내는 요청 본문의 합 상한(바이트).
 *
 * Fetch 표준은 한 페이지가 keepalive로 동시에 보내는 본문을 64KiB로 묶고, 넘는 요청은
 * 네트워크 오류로 끝낸다(https://fetch.spec.whatwg.org/#http-network-or-cache-fetch).
 * `sendBeacon`도 keepalive 요청이라 같은 64KiB를 나눠 쓴다(https://w3c.github.io/beacon/).
 * 실패 보고가 `sendBeacon`으로 보낼 몫을 남기려고 그보다 낮게 둔다.
 */
export const KEEPALIVE_BODY_BUDGET = 48 * 1024;

let keepaliveBytesInFlight = 0;

const HEALTH_PATH = "/api/health";

const BULK_PULL_PATHS = new Set([
  "/api/presentations",
  "/api/decks",
  "/api/folders",
  "/api/backgrounds",
]);

const PERMANENT_DELETE_PATH = /^\/api\/(?:folders|presentations)\/[^/]+$/;

/**
 * 요청 URL과 메서드에 맞는 데드라인(ms)을 반환한다.
 * 부팅 및 목록 동기화 시 대용량 JSON을 가져오는 전체 목록 pull 요청과 영구 삭제에는 더 넉넉한
 * 시간을 둔다.
 */
export function getDeadlineForRequest(url: string, method = "GET"): number {
  const upperMethod = method.toUpperCase();
  const pathname = new URL(url, "http://localhost").pathname;
  if (upperMethod === "DELETE" && PERMANENT_DELETE_PATH.test(pathname)) {
    return DELETE_API_TIMEOUT_MS;
  }
  if (upperMethod === "GET") {
    if (pathname === HEALTH_PATH) return HEALTH_API_TIMEOUT_MS;
    if (BULK_PULL_PATHS.has(pathname)) {
      return PULL_API_TIMEOUT_MS;
    }
  }
  return DEFAULT_API_TIMEOUT_MS;
}

/**
 * 여러 AbortSignal을 하나로 합친다.
 * 브라우저 표준 AbortSignal.any()를 우선 사용하고, 미지원 환경을 위한 폴백을 제공한다.
 */
export function combineSignals(
  ...signals: Array<AbortSignal | null | undefined>
): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => !!s);
  if (active.length === 0) {
    throw new Error("At least one signal required");
  }
  const only = onlyItem(active);
  if (only) return only;

  for (const signal of active) {
    if (signal.aborted) {
      if (typeof AbortSignal.abort === "function") {
        return AbortSignal.abort(signal.reason);
      }
      const controller = new AbortController();
      controller.abort(signal.reason);
      return controller.signal;
    }
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }

  const controller = new AbortController();
  const onAbort = (e: Event): void => {
    const target = e.target as AbortSignal;
    controller.abort(target.reason);
    cleanup();
  };
  const cleanup = (): void => {
    for (const signal of active) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  for (const signal of active) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  return controller.signal;
}

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

function keepaliveBodyBytes(
  input: RequestInfo | URL,
  method: string,
  body: BodyInit | null | undefined,
): number | null {
  if (
    typeof document === "undefined" ||
    document.visibilityState !== "hidden"
  ) {
    return null;
  }
  if (input instanceof Request) return null;
  const upperMethod = method.toUpperCase();
  if (upperMethod === "GET" || upperMethod === "HEAD") return null;
  if (body === undefined || body === null) return 0;
  if (typeof body !== "string") return null;
  return new TextEncoder().encode(body).byteLength;
}

/**
 * 요청마다 독립적인 데드라인을 붙여 fetch를 실행한다.
 *
 * 주의: `init`에 고정된 signal을 두면 한 번 만료된 신호가 다음 요청에 재사용되므로,
 * 매 요청마다 새로 `AbortSignal.timeout(timeoutMs)`을 만든다.
 * 호출자가 넘긴 signal이 있으면 `AbortSignal.any`로 합성한다.
 *
 * 요청마다 `traceparent`를 붙이고(호출자가 이미 붙였으면 그대로 둔다), 그 상관 ID와
 * 경로 패턴을 응답이나 던진 오류에 남긴다(`requestMetaOf`). 타임아웃으로 응답이 없어도
 * 사용자 화면의 실패를 Worker 로그와 이을 수 있다.
 *
 * 페이지가 숨겨진 동안(탭 전환, `pagehide`) 보내는 쓰기 요청은 본문이 문자열이거나 없으면
 * keepalive로 보낸다. 탭을 닫으며 비운 큐의 마지막 편집이 페이지와 함께 끊기지 않게 하려는
 * 것이다. 응답을 기다리는 keepalive 본문의 합이 `KEEPALIVE_BODY_BUDGET`을 넘으면 그 요청은
 * 평소처럼 보낸다. 보이는 페이지, 읽기 요청, 파일 올리기(FormData)는 그대로다.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: FetchWithTimeoutOptions,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  const timeoutMs = init?.timeoutMs ?? getDeadlineForRequest(url, method);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  const callerSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = callerSignal
    ? combineSignals(callerSignal, timeoutSignal)
    : timeoutSignal;

  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const trace = createTraceContext();
  if (!headers.has(TRACEPARENT_HEADER)) {
    headers.set(TRACEPARENT_HEADER, trace.traceparent);
  }
  const meta: RequestMeta = {
    requestId: traceIdOf(headers.get(TRACEPARENT_HEADER)) ?? trace.requestId,
    route: toRoutePattern(url),
  };

  const bodyBytes = keepaliveBodyBytes(input, method, init?.body);
  const keepalive =
    bodyBytes !== null &&
    keepaliveBytesInFlight + bodyBytes <= KEEPALIVE_BODY_BUDGET;
  const keptAliveBytes = keepalive ? bodyBytes : 0;
  keepaliveBytesInFlight += keptAliveBytes;

  try {
    const response = await globalThis.fetch(input, {
      ...init,
      headers,
      signal,
      ...(keepalive ? { keepalive: true } : {}),
    });
    rememberRequestMeta(response, meta);
    return response;
  } catch (err) {
    if (err !== null && typeof err === "object") rememberRequestMeta(err, meta);
    throw err;
  } finally {
    keepaliveBytesInFlight -= keptAliveBytes;
  }
}
