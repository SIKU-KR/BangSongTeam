import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createD1Client, user, session, account, verification } from "#db";
import {
  APP_NAME,
  createId,
  FALLBACK_USER_NAME,
  type SocialProvider,
} from "#shared";
import type { Bindings } from "../types";
import { devSignIn } from "./devSignIn";

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

/**
 * 세션 쿠키 캐시 유효 시간(초).
 *
 * 이 시간 동안은 서명된 `session_data` 쿠키로 세션을 확인하고 D1의 `session`·`user`를
 * 읽지 않는다. 그 대가로 다른 기기에서의 세션 폐기·계정 삭제는 최대 이 시간만큼 늦게
 * 반영된다. 같은 브라우저의 로그아웃은 쿠키를 함께 지우므로 바로 반영된다.
 */
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/** 소셜 프로필에서 만들어 내는 로컬 사용자 속성 */
interface MappedSocialUser {
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
    name: nickname || FALLBACK_USER_NAME.kakao,
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
    name: displayName || FALLBACK_USER_NAME.naver,
    email: email || syntheticEmail("naver", id),
    image: response?.profile_image,
    emailVerified: Boolean(email),
  };
}

/** 실제로 자격증명이 설정된 소셜 프로바이더 */
export function configuredSocialProviders(env: Bindings): SocialProvider[] {
  const providers: SocialProvider[] = [];
  if (hasCredentials(env.KAKAO_CLIENT_ID, env.KAKAO_CLIENT_SECRET)) {
    providers.push("kakao");
  }
  if (hasCredentials(env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET)) {
    providers.push("naver");
  }
  if (hasCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)) {
    providers.push("google");
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

  if (hasCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      prompt: "select_account",
    };
  }

  return betterAuth({
    appName: APP_NAME,
    basePath: AUTH_BASE_PATH,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    session: {
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    rateLimit: { enabled: true },
    telemetry: { enabled: false },
    socialProviders,
    plugins: import.meta.env.DEV ? [devSignIn()] : [],
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
 * - 로그인은 소셜 로그인뿐이다. 서버에 비밀번호 해시를 두지 않으려고 `emailAndPassword`는
 *   켜지 않는다. `pnpm dev`에서만 시드 계정 로그인(`devSignIn`)이 더해진다.
 * - 이메일이 검증된 소셜 계정끼리는 같은 이메일이면 한 사용자로 합쳐진다. 이메일이
 *   검증되지 않은 기존 사용자(카카오 합성 이메일, 예전 비밀번호 계정)에는
 *   `requireLocalEmailVerified` 기본값 때문에 자동으로 붙지 않고 "account not linked"로
 *   실패한다 (선점 방지).
 * - 구글은 교회 공용 PC에서 이전 사람의 구글 계정으로 조용히 들어가지 않도록
 *   `prompt: "select_account"`로 매번 계정을 고르게 한다.
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
