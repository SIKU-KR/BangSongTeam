import { MEDIA_URL_PREFIX, randomHex } from "#shared";

export interface TraceContext {
  traceparent: string;
  requestId: string;
}

/**
 * 요청 하나의 W3C Trace Context(`traceparent`)를 만든다. `requestId`는 그 trace-id다.
 *
 * 브라우저가 ID를 정해 보내야, 응답을 받지 못한 요청(타임아웃·끊김)도 Worker 로그의
 * `requestId`와 같은 값을 손에 쥘 수 있다. Worker는 이 trace-id를 상관 ID로 쓴다.
 */
export function createTraceContext(): TraceContext {
  const requestId = randomHex(16);
  return { traceparent: `00-${requestId}-${randomHex(8)}-01`, requestId };
}

const KEPT_SEGMENT = /^[a-z]+(-[a-z]+)*$/;
const MAX_KEPT_SEGMENT_LENGTH = 20;

function toPatternSegment(segment: string): string {
  return segment.length <= MAX_KEPT_SEGMENT_LENGTH && KEPT_SEGMENT.test(segment)
    ? segment
    : ":id";
}

/**
 * 요청 URL을 보고에 실을 경로 패턴으로 줄인다 (`/api/presentations/:id`).
 *
 * id·공유 토큰·미디어 키가 기기 밖으로 나가지 않게 한다. 경로 마디는 짧은 소문자
 * 낱말(`presentations`, `join`)만 남기고 나머지는 `:id`로 바꾼다. id는
 * 21자 NanoID라 이 길이 제한에 걸린다. 미디어는 키 전체를 `/api/media/*`로 묶는다.
 */
export function toRoutePattern(url: string): string {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname.startsWith(MEDIA_URL_PREFIX)) return `${MEDIA_URL_PREFIX}*`;
  const [root, ...segments] = pathname.split("/").filter(Boolean);
  if (root !== "api") return "/api";
  return ["/api", ...segments.map(toPatternSegment)].join("/");
}

export interface RequestMeta {
  requestId: string;
  route: string;
}

const metas = new WeakMap<object, RequestMeta>();

/**
 * 응답이나 던져진 오류에 그 요청의 상관 ID와 경로 패턴을 붙여 둔다.
 *
 * Hono RPC 클라이언트(`hc`)는 커스텀 fetch가 돌려준 `Response`와 던진 오류를 그대로
 * 넘기므로, 요청 시그니처를 바꾸지 않고도 `callApi`가 이 값을 다시 찾을 수 있다.
 */
export function rememberRequestMeta(target: object, meta: RequestMeta): void {
  metas.set(target, meta);
}

export function requestMetaOf(target: unknown): RequestMeta | undefined {
  return target !== null && typeof target === "object"
    ? metas.get(target)
    : undefined;
}
