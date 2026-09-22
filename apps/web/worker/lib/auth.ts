import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createD1Client, user, session, account, verification } from "@repo/db";
import type { Bindings } from "../types";

/**
 * Better Auth 마운트 경로.
 *
 * `wrangler.jsonc`의 `assets.run_worker_first: ["/api/*"]`가 이 경로를 덮는다.
 * `/auth/*`로 옮기면 정적 자산 핸들러가 먼저 가로채 로그인이 조용히 깨진다.
 */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * 소셜 프로바이더가 이메일을 주지 않을 때 쓰는 합성 도메인.
 *
 * 카카오 `account_email`은 비즈 앱 심사를 통과해야 내려온다. 이메일이 없다고
 * 가입을 실패시키면 카카오 로그인 자체가 막히므로, 계정 식별용 주소를 만들어
 * 넣고 `emailVerified: false`로 표시한다. 실제로 메일을 보내는 주소가 아니다.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "users.noreply.worship-slide.local";

/** 소셜 프로필에서 만들어 내는 로컬 사용자 속성 */
export interface MappedSocialUser {
  name: string;
  email: string;
  image?: string;
  emailVerified: boolean;
}

export interface KakaoProfileLike {
  id: number | string;
  kakao_account?: {
    email?: string | null;
    is_email_verified?: boolean;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
      thumbnail_image_url?: string;
    };
  };
  properties?: {
    nickname?: string;
    profile_image?: string;
  };
}

export interface NaverProfileLike {
  response?: {
    id: string;
    email?: string | null;
    name?: string;
    nickname?: string;
    profile_image?: string;
  };
}

/**
 * 사용자 id 생성기.
 *
 * Better Auth 기본 id는 32자 nanoid인데 `@repo/shared`의 `DeckSchema.userId`와
 * `PresentationSchema.userId`가 `z.string().uuid()`다. 스키마를 느슨하게 푸는
 * 대신 id 쪽을 UUID로 맞춘다 (단일 원천 유지).
 */
export function generateUserId(): string {
  return crypto.randomUUID();
}

/**
 * 개발자 로그인이 살아 있는지.
 *
 * **이중 방어다.** 이 경로가 운영에 열려 있으면 누구나 아무 계정으로 로그인할
 * 수 있다.
 *
 * 1. `DEV_LOGIN_ENABLED=true` 명시적 플래그 — 기본은 꺼짐
 * 2. 요청 호스트가 localhost — 플래그가 실수로 운영 시크릿에 들어가도
 *    실제 도메인에서는 여전히 죽는다
 */
export function isDevLoginEnabled(
  env: Bindings,
  requestUrl: string | URL,
): boolean {
  if (env.DEV_LOGIN_ENABLED !== "true") return false;

  let hostname: string;
  try {
    hostname = new URL(requestUrl).hostname;
  } catch {
    return false;
  }

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/** 자격증명이 실제로 채워져 있는지 (빈 문자열·공백은 미설정으로 본다) */
export function hasCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
): boolean {
  return Boolean(clientId?.trim()) && Boolean(clientSecret?.trim());
}

function syntheticEmail(provider: string, id: string | number): string {
  return `${provider}_${id}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function buildKakaoUser(profile: KakaoProfileLike): MappedSocialUser {
  const account = profile.kakao_account;
  const nickname =
    account?.profile?.nickname ?? profile.properties?.nickname ?? "";
  const image =
    account?.profile?.profile_image_url ??
    account?.profile?.thumbnail_image_url ??
    profile.properties?.profile_image;
  const email = account?.email?.trim();

  return {
    name: nickname || "카카오 사용자",
    email: email || syntheticEmail("kakao", profile.id),
    image,
    emailVerified: Boolean(email) && account?.is_email_verified === true,
  };
}

export function buildNaverUser(profile: NaverProfileLike): MappedSocialUser {
  const response = profile.response;
  const displayName = response?.nickname ?? response?.name ?? "";
  const email = response?.email?.trim();
  const id = response?.id ?? "unknown";

  return {
    name: displayName || "네이버 사용자",
    email: email || syntheticEmail("naver", id),
    image: response?.profile_image,
    emailVerified: Boolean(email),
  };
}

/** 실제로 자격증명이 설정된 소셜 프로바이더 */
export function configuredSocialProviders(
  env: Bindings,
): Array<"kakao" | "naver"> {
  const providers: Array<"kakao" | "naver"> = [];
  if (hasCredentials(env.KAKAO_CLIENT_ID, env.KAKAO_CLIENT_SECRET)) {
    providers.push("kakao");
  }
  if (hasCredentials(env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET)) {
    providers.push("naver");
  }
  return providers;
}

function buildAuth(env: Bindings) {
  const db = createD1Client(env.DB);

  const socialProviders: Record<string, unknown> = {};

  if (hasCredentials(env.KAKAO_CLIENT_ID, env.KAKAO_CLIENT_SECRET)) {
    socialProviders.kakao = {
      clientId: env.KAKAO_CLIENT_ID as string,
      clientSecret: env.KAKAO_CLIENT_SECRET as string,
      mapProfileToUser: (profile: KakaoProfileLike) => buildKakaoUser(profile),
    };
  }

  if (hasCredentials(env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET)) {
    socialProviders.naver = {
      clientId: env.NAVER_CLIENT_ID as string,
      clientSecret: env.NAVER_CLIENT_SECRET as string,
      mapProfileToUser: (profile: NaverProfileLike) => buildNaverUser(profile),
    };
  }

  return betterAuth({
    appName: "Worship Slide",
    basePath: AUTH_BASE_PATH,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    // 비밀번호 로그인은 MVP 범위 밖이다 (PRD 4.6: 소셜 로그인만).
    //
    // 예외: 개발자 로그인이 이 엔드포인트를 쓴다. 플래그가 꺼져 있으면
    // better-auth가 비밀번호 엔드포인트 자체를 만들지 않으므로, 라우트 가드가
    // 뚫리더라도 로그인할 방법이 없다 (방어선 3겹).
    emailAndPassword: { enabled: env.DEV_LOGIN_ENABLED === "true" },
    // 텔레메트리 모듈이 node:os를 import해 workerd에서 로드에 실패한다.
    // Worker에서 외부로 사용 통계를 보낼 이유도 없다.
    telemetry: { enabled: false },
    socialProviders,
    advanced: {
      database: {
        generateId: () => generateUserId(),
      },
    },
  });
}

/**
 * betterAuth()는 전달한 옵션 리터럴로 좁혀진 타입을 돌려준다.
 * `ReturnType<typeof betterAuth>`(제네릭 기본값)로 적으면 대입이 되지 않으므로
 * 실제 팩토리에서 추론한다.
 */
type AuthInstance = ReturnType<typeof buildAuth>;

/**
 * isolate 내 인스턴스 캐시.
 *
 * Worker는 요청마다 `env`를 받으므로 모듈 스코프 싱글턴을 만들 수 없다.
 * 대신 같은 `env` 객체에 대해서는 인스턴스를 재사용한다. 요청마다 D1 어댑터를
 * 새로 엮으면 비용이 그대로 응답 지연이 된다.
 */
const instances = new WeakMap<Bindings, AuthInstance>();

export function createAuth(env: Bindings): AuthInstance {
  const cached = instances.get(env);
  if (cached) return cached;

  const auth = buildAuth(env);
  instances.set(env, auth);
  return auth;
}
