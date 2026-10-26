import { createHash, timingSafeEqual } from "node:crypto";

/** 앞단 프록시(Cloudflare Worker)가 자신을 증명하려고 붙이는 비밀값 헤더 */
export const PROXY_SECRET_HEADER = "x-bst-proxy-secret";

/** 앞단 프록시가 본 사용자 IP(`cf-connecting-ip`)를 실어 보내는 헤더 */
export const PROXY_CLIENT_IP_HEADER = "x-bst-client-ip";

/**
 * 요청한 브라우저의 IP. Cloud Run 앞단(Google Front End)이 `x-forwarded-for`에 붙여 준다.
 *
 * 첫 값을 쓴다. 클라이언트가 이 헤더를 직접 보내면 첫 값을 바꿀 수 있어, 빈도 제한 같은
 * 최선 노력 방어에만 쓴다. 뒤쪽 값은 앞단 구성(로드 밸런서 유무)에 따라 달라 모든 요청이
 * 같은 키로 묶일 수 있다.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function sameSecret(received: string, expected: string): boolean {
  const digest = (value: string): Buffer =>
    createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

/**
 * 프록시를 거친 요청의 `x-forwarded-for`를 프록시가 알려 준 사용자 IP 하나로 바꾼다.
 *
 * 도메인은 Cloudflare Worker가 run.app으로 넘겨 주므로, 그대로 두면 Cloud Run이 보는 IP는
 * Cloudflare 출구 IP이고 Better Auth의 빈도 제한이 사용자 여럿을 한 키로 묶는다. 비밀값이
 * 맞을 때만 프록시 헤더를 믿는다. 아무나 Cloudflare Worker로 run.app에 직접 요청할 수 있어
 * Cloudflare IP 대역을 믿는 방식은 위조를 막지 못한다. 프록시 헤더는 비밀값이 맞든 틀리든
 * 지워서 뒤쪽 코드에 닿지 않게 한다.
 */
export function withTrustedClientIp(
  request: Request,
  proxySecret: string | undefined,
): Request {
  const secret = request.headers.get(PROXY_SECRET_HEADER);
  const ip = request.headers.get(PROXY_CLIENT_IP_HEADER)?.trim();
  if (secret === null && ip === undefined) return request;

  const headers = new Headers(request.headers);
  headers.delete(PROXY_SECRET_HEADER);
  headers.delete(PROXY_CLIENT_IP_HEADER);
  if (proxySecret && secret && ip && sameSecret(secret, proxySecret)) {
    headers.set("x-forwarded-for", ip);
  }
  return new Request(request, { headers });
}
