import { createHmac } from "node:crypto";
import { APIError } from "better-auth/api";
import { takeSignUpQuota } from "#db";
import { API_ERRORS } from "#shared";
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
 * 만들지 않고 429로 끊는다. Better Auth가 사용자를 만들기 직전에 부르므로, 이미 가입한 이메일이나
 * 잘못된 입력처럼 사용자를 만들지 않는 요청은 세지 않는다.
 *
 * Better Auth의 IP당 빈도 제한(10초에 3번)은 인스턴스 메모리에 있어 몇 분이면 계정 수백 개를 만들 수
 * 있고, 계정마다의 하루 한도(`DAILY_USER_LIMITS`)가 그만큼 곱절이 된다. 그래서 가입 수를 Firestore에
 * 날마다 센다. 소셜 로그인 가입은 그쪽 계정을 따로 만들어야 해서 세지 않는다.
 *
 * IP를 모르면(로컬 개발) 세지 않는다. Cloud Run 앞단은 언제나 `x-forwarded-for`를 붙인다. 프록시
 * 비밀값이 어긋나면 모든 가입이 Cloudflare 출구 IP 몇 개로 묶여 한도에 일찍 닿는다
 * (`proxy_secret_mismatch` 경고).
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
    message: API_ERRORS.tooManyRequests,
  });
}
