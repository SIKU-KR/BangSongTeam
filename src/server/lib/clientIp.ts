import { createHash, timingSafeEqual } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { writeLog } from "./requestLog";

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

function hextetsOf(part: string): string[] {
  if (!part) return [];
  const groups = part.split(":");
  const last = groups.at(-1) ?? "";
  if (!isIPv4(last)) return groups;
  const [a = 0, b = 0, c = 0, d = 0] = last.split(".").map(Number);
  return [
    ...groups.slice(0, -1),
    ((a << 8) | b).toString(16),
    ((c << 8) | d).toString(16),
  ];
}

function expandIPv6(ip: string): string[] {
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = hextetsOf(head);
  const right = tail === undefined ? [] : hextetsOf(tail);
  const zeros = Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((group) => group.padStart(4, "0"));
}

/**
 * 빈도 제한을 셀 IP 단위. IPv6는 앞 64비트(/64) 대역으로 묶고, IPv4를 담은 IPv6
 * (`::ffff:192.0.2.1`)는 IPv4로 센다.
 *
 * IPv6 사용자는 대개 /64 대역을 통째로 받아 그 안에서 주소를 마음대로 바꿀 수 있어, 주소마다
 * 따로 세면 주소를 바꿔 가며 한도를 피한다. Better Auth도 같은 까닭에 /64로 묶어 센다
 * (`ipv6Subnet` 기본값).
 */
export function rateLimitKey(ip: string): string {
  if (!isIPv6(ip)) return ip;
  const groups = expandIPv6(ip);
  const mapsIPv4 =
    groups.slice(0, 5).every((group) => group === "0000") &&
    groups[5] === "ffff";
  if (mapsIPv4) {
    return groups
      .slice(6)
      .flatMap((group) => [group.slice(0, 2), group.slice(2)])
      .map((byte) => Number.parseInt(byte, 16))
      .join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

function sameSecret(received: string, expected: string): boolean {
  const digest = (value: string): Buffer =>
    createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

let warnedSecretMismatch = false;

function warnSecretMismatchOnce(configured: boolean): void {
  if (warnedSecretMismatch) return;
  warnedSecretMismatch = true;
  writeLog("WARNING", { event: "proxy_secret_mismatch", configured });
}

export function __resetProxySecretWarningForTests(): void {
  warnedSecretMismatch = false;
}

/**
 * 프록시를 거친 요청의 `x-forwarded-for`를 프록시가 알려 준 사용자 IP 하나로 바꾼다.
 *
 * 도메인은 Cloudflare Worker가 run.app으로 넘겨 주므로, 그대로 두면 Cloud Run이 보는 IP는
 * Cloudflare 출구 IP이고 Better Auth의 빈도 제한이 사용자 여럿을 한 키로 묶는다. 비밀값이
 * 맞을 때만 프록시 헤더를 믿는다. 아무나 Cloudflare Worker로 run.app에 직접 요청할 수 있어
 * Cloudflare IP 대역을 믿는 방식은 위조를 막지 못한다. 프록시 헤더는 비밀값이 맞든 틀리든
 * 지워서 뒤쪽 코드에 닿지 않게 한다.
 *
 * 프록시 헤더가 왔는데 비밀값이 없거나 틀리면 `proxy_secret_mismatch` WARNING을 프로세스마다
 * 한 번 남긴다. Worker와 Cloud Run의 비밀값이 어긋나면(교체 중 한쪽만 바꾼 경우 등) 모든 사용자가
 * 로그인 빈도 제한 하나를 나눠 써 429가 나는데, 응답만으로는 알 수 없다. 누구나 run.app에 이
 * 헤더를 보낼 수 있으므로 요청마다 남기지 않는다.
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
  if (!proxySecret || !secret || !sameSecret(secret, proxySecret)) {
    warnSecretMismatchOnce(Boolean(proxySecret));
  } else if (ip) {
    headers.set("x-forwarded-for", ip);
  }
  return new Request(request, { headers });
}
