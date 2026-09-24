import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createD1Client, user, session, account, verification } from "#db";
import { createId, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "#shared";
import type { Bindings } from "../types";
import { hashPassword, verifyPassword } from "./password";

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
 * Better Auth 기본 id는 32자 nanoid인데 `#shared`의 `DeckSchema.userId`와
 * `PresentationSchema.userId`는 `IdSchema`(21자 NanoID)다. 스키마를 느슨하게 푸는
 * 대신 id 쪽을 공용 `createId()`로 맞춘다 (단일 원천 유지).
 */
export function generateUserId(): string {
  return createId();
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

/** 쉼표·공백·줄바꿈으로 구분된 이메일 목록. 대소문자는 구분하지 않는다. */
export function parseEmailAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * 이메일·비밀번호 로그인이 켜져 있는지.
 *
 * 가입 허용 목록(`EMAIL_SIGNUP_ALLOWLIST` 시크릿)이 곧 스위치다. 목록을 비우면
 * 로그인 화면의 폼과 로그인·가입 엔드포인트가 함께 꺼진다.
 */
export function isEmailLoginEnabled(env: Bindings): boolean {
  return parseEmailAllowlist(env.EMAIL_SIGNUP_ALLOWLIST).size > 0;
}

/**
 * 이 이메일로 비밀번호 가입을 받아도 되는지.
 *
 * 메일 인증 없이 가입시키므로 아무 주소나 받으면 남의 이메일을 선점할 수 있다.
 * 허용 목록에 적힌 주소만 받는다.
 */
export function isEmailSignupAllowed(env: Bindings, email: string): boolean {
  return parseEmailAllowlist(env.EMAIL_SIGNUP_ALLOWLIST).has(
    email.trim().toLowerCase(),
  );
}

/**
 * 배경 갤러리 관리자(`ADMIN_USER_IDS` 시크릿, 쉼표로 구분한 user id)인지.
 *
 * 이메일이 아니라 user id로 가린다. 카카오 이메일과 비밀번호 계정 이메일은
 * 검증되지 않아 남이 같은 주소로 가입할 수 있다. 목록이 비어 있으면 관리자가 없다.
 */
export function isAdminUser(
  env: Bindings,
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  return (env.ADMIN_USER_IDS ?? "")
    .split(/[\s,]+/)
    .some((id) => id.length > 0 && id === userId);
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
    emailAndPassword: {
      enabled: isEmailLoginEnabled(env) || env.DEV_LOGIN_ENABLED === "true",
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    disabledPaths: ["/sign-up/email"],
    rateLimit: { enabled: true },
    telemetry: { enabled: false },
    socialProviders,
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: {
        generateId: () => generateUserId(),
      },
    },
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;

const instances = new WeakMap<Bindings, AuthInstance>();

/**
 * Better Auth 인스턴스 생성 또는 캐시 조회.
 *
 * - 비밀번호 가입은 공개 경로(`/api/auth/sign-up/email`)를 닫고, 허용 목록을 거치는
 *   `/api/email-signup`과 개발자 로그인이 서버 안에서 `auth.api.signUpEmail`로만 받는다.
 *   `disabledPaths`는 HTTP 라우터에서만 검사하므로 서버 내부 호출은 통과한다.
 * - 비밀번호 사용자는 `emailVerified=false`다. Better Auth의 `requireLocalEmailVerified`
 *   기본값 때문에 같은 이메일의 카카오·네이버 로그인이 이 계정에 자동으로 붙지 않는다
 *   (선점 방지). 그 대신 해당 소셜 로그인은 "account not linked"로 실패한다.
 * - rate limit은 `NODE_ENV=production`에서만 기본으로 켜지는데 Workers에는 그 값이 없어
 *   명시적으로 켠다. 저장소가 isolate 메모리라 부분 방어다.
 */
export function createAuth(env: Bindings): AuthInstance {
  const cached = instances.get(env);
  if (cached) return cached;

  const auth = buildAuth(env);
  instances.set(env, auth);
  return auth;
}
