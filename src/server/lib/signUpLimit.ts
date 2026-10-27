import { createHmac } from "node:crypto";
import { APIError } from "better-auth/api";
import { takeSignUpQuota } from "#db";
import { API_ERRORS, DAILY_SIGN_UP_LIMIT_CODE } from "#shared";
import type { Bindings } from "../types";
import { clientIp, rateLimitKey } from "./clientIp";

/**
 * 이메일 가입 하루 한도를 세는 IP 키. IP를 빈도 제한 단위(`rateLimitKey`, IPv6는 /64)로 묶고
 * Better Auth 비밀값으로 해시해, Firestore에는 IP가 남지 않는다.
 */
export function signUpQuotaKey(ip: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(rateLimitKey(ip))
    .digest("hex")
    .slice(0, 32);
}

/**
 * 이메일 가입을 IP 하나에서 하루(한국 시간) `DAILY_SIGN_UPS_PER_IP`번까지 받는다. 넘으면 사용자를
 * 만들지 않고 429로 끊으며, 응답 `code`(`DAILY_SIGN_UP_LIMIT_CODE`)로 다른 빈도 제한과 나눈다.
 * Better Auth가 사용자를 만들기 직전에 부르므로, 이미 가입한 이메일이나 잘못된 입력처럼 사용자를
 * 만들지 않는 요청은 세지 않는다.
 *
 * Better Auth의 IP당 빈도 제한(10초에 3번)은 인스턴스 메모리에 있어 몇 분이면 계정 수백 개를 만들 수
 * 있고, 계정마다의 하루 한도(`DAILY_USER_LIMITS`)가 그만큼 곱절이 된다. 그래서 가입 수를 Firestore에
 * 날마다 센다. 소셜 로그인 가입은 그쪽 계정을 따로 만들어야 해서 세지 않는다.
 *
 * IP는 `clientIp`로 읽는다. 공개 도메인으로 온 가입은 프록시가 알려 준 IP라 믿을 수 있지만, run.app에
 * 바로 보낸 요청은 `x-forwarded-for` 첫 값을 보내는 쪽이 정한다. 프록시를 거치지 않은 요청을 막기
 * 전에는 값을 바꿔 가며 run.app에 보내는 스크립트를 이 한도로 막지 못한다. 프록시 비밀값이 어긋나면
 * 모든 가입이 Cloudflare 출구 IP 몇 개로 묶여 한도에 일찍 닿는다(`proxy_secret_mismatch` 경고).
 *
 * `x-forwarded-for`가 없으면 세지 않는다. Cloud Run 앞단과 Next.js 서버가 늘 채우므로 운영과 로컬
 * 개발에서는 언제나 센다. 로컬 개발 서버(`pnpm dev`·`pnpm start`)에서는 Next.js가 소켓 주소를 채워
 * 모든 가입을 루프백 주소 하나로 센다. 한도에 닿으면 `pnpm db:seed:local`로 비운다.
 */
export async function limitEmailSignUps(
  env: Bindings,
  headers: Headers | undefined,
  now: Date = new Date(),
): Promise<void> {
  const ip = headers ? clientIp(headers) : "unknown";
  if (ip === "unknown") return;
  const key = signUpQuotaKey(ip, env.BETTER_AUTH_SECRET ?? "");
  if (await takeSignUpQuota(env.DB, key, now)) return;
  throw new APIError("TOO_MANY_REQUESTS", {
    message: API_ERRORS.auth.dailySignUpLimit,
    code: DAILY_SIGN_UP_LIMIT_CODE,
  });
}
