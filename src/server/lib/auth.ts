import { betterAuth } from "better-auth/minimal";
import { firestoreAdapter } from "#db";
import {
  APP_NAME,
  createId,
  FALLBACK_USER_NAME,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SocialProviderSchema,
  toDisplayName,
  type SocialProvider,
} from "#shared";
import type { Bindings } from "../types";
import { devSignIn } from "./devSignIn";
import { hashPassword, verifyPassword } from "./password";

/**
 * 소셜 프로바이더가 이메일을 주지 않을 때 쓰는 합성 도메인.
 *
 * 카카오 `account_email`은 비즈 앱 심사를 통과해야 내려온다. 이메일이 없다고
 * 가입을 실패시키면 카카오 로그인 자체가 막히므로, 계정 식별용 주소를 만들어
 * 넣고 `emailVerified: false`로 표시한다. 실제로 메일을 보내는 주소가 아니다.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "users.noreply.worship-slide.local";

/**
 * 로그인 유지 기간(초). 마지막으로 쓴 날부터 30일 동안은 다시 로그인하지 않아도 된다.
 *
 * Better Auth 기본값(7일)이면 주일에만 앱을 여는 사람은 지난주보다 조금만 늦게 열어도 예배
 * 직전에 로그아웃된다. 이메일 가입자는 비밀번호 재설정이 없어 다시 들어오기도 어렵다. 대신
 * 로그아웃하지 않은 공용 PC에는 로그인이 그만큼 오래 남는다.
 */
const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;

/** 유지 기간을 다시 늘리는 간격(초). 하루에 처음 쓸 때만 세션 문서를 고쳐 쓴다 */
const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/**
 * 세션 쿠키 캐시 유효 시간(초).
 *
 * 이 시간 동안은 서명된 `session_data` 쿠키로 세션을 확인하고 Firestore의 `sessions`·`users`를
 * 읽지 않는다. 그 대가로 다른 기기에서의 세션 폐기·계정 삭제는 최대 이 시간만큼 늦게
 * 반영된다. 같은 브라우저의 로그아웃은 쿠키를 함께 지우므로 바로 반영된다.
 */
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/**
 * Better Auth 빈도 제한에서 기본값을 바꾸는 경로. 기본은 `/sign-in*`·`/sign-up*` 모두 IP마다
 * 10초에 3번이다.
 *
 * 소셜 로그인 시작(`/sign-in/social`)은 비밀번호를 받지 않아 맞혀 볼 것이 없다. 교회 와이파이처럼
 * 공인 IP 하나를 나눠 쓰는 팀이 함께 로그인해도 막히지 않게 10초에 20번까지 받는다. 이메일
 * 로그인·가입은 계정마다 잠그는 장치가 없어 이 IP당 제한이 비밀번호 대입과 가입 남용을 막는
 * 유일한 장치라 기본값을 그대로 둔다.
 */
const RATE_LIMIT_RULES = {
  "/sign-in/social": { window: 10, max: 20 },
};

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
    /** 다른 카카오계정이 이 이메일을 가져가면 `false`가 된다 */
    is_email_valid?: boolean;
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

/**
 * id·secret이 모두 채워져 Better Auth에 등록하는 소셜 로그인. 로그인 화면의 순서를 따른다.
 *
 * 운영에서는 이 값이 소셜 로그인을 켜고 끄는 스위치다. 로그인 화면이 버튼을 고르는
 * `GET /api/auth-config`도 이 목록을 그대로 알려 줘, 보이는 버튼과 시작할 수 있는 로그인이
 * 어긋나지 않는다.
 */
export function configuredSocialProviders(env: Bindings): SocialProvider[] {
  const credentials: Record<
    SocialProvider,
    readonly [string | undefined, string | undefined]
  > = {
    kakao: [env.KAKAO_CLIENT_ID, env.KAKAO_CLIENT_SECRET],
    naver: [env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET],
    google: [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
  };
  return SocialProviderSchema.options.filter((provider) =>
    hasCredentials(...credentials[provider]),
  );
}

function syntheticEmail(provider: string, id: string | number): string {
  return `${provider}_${id}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * 카카오 프로필을 로컬 사용자로 옮긴다. 인증했고(`is_email_verified`) 지금도 이 계정의 것인
 * (`is_email_valid`) 이메일만 인증된 이메일로 본다. Better Auth 기본 매핑과 같은 규칙이다.
 *
 * 인증된 이메일은 같은 이메일의 기존 계정에 소셜 계정을 묶는 근거다(`ACCOUNT_LINKING`). 예전에
 * 인증했다가 다른 카카오계정으로 넘어간 주소를 믿으면, 그 주소의 옛 주인이 지금 주인의 계정에
 * 들어간다.
 */
export function buildKakaoUser(profile: KakaoProfileLike): MappedSocialUser {
  const account = profile.kakao_account;
  const kakaoProfile = account?.profile;
  const nickname = kakaoProfile?.nickname ?? profile.properties?.nickname ?? "";
  const image =
    kakaoProfile?.profile_image_url ??
    kakaoProfile?.thumbnail_image_url ??
    profile.properties?.profile_image;
  const email = account?.email?.trim();

  return {
    name: nickname || FALLBACK_USER_NAME.kakao,
    email: email || syntheticEmail("kakao", profile.id),
    image,
    emailVerified:
      Boolean(email) &&
      account?.is_email_verified === true &&
      account.is_email_valid === true,
  };
}

/**
 * 네이버 프로필을 로컬 사용자로 옮긴다. 네이버 프로필 API는 이메일 인증 여부를 알려 주지 않아
 * Better Auth 기본 매핑처럼 언제나 인증되지 않은 이메일로 본다.
 */
export function buildNaverUser(profile: NaverProfileLike): MappedSocialUser {
  const response = profile.response;
  const displayName = response?.nickname ?? response?.name ?? "";
  const email = response?.email?.trim();
  const id = response?.id ?? "unknown";

  return {
    name: displayName || FALLBACK_USER_NAME.naver,
    email: email || syntheticEmail("naver", id),
    image: response?.profile_image,
    emailVerified: false,
  };
}

/**
 * 소셜 로그인을 같은 이메일의 기존 계정에 묶을 때, 그 계정의 이메일이 인증됐는지도 따진다.
 *
 * 이메일·비밀번호 가입은 메일 인증을 거치지 않아서, 남의 이메일로 먼저 가입해 둔 사람이
 * 피해자가 나중에 Google로 로그인할 때 그 계정에 합류하는 선점 탈취가 가능하다. Better Auth는
 * `requireLocalEmailVerified`(기본 true)가 켜져 있으면 소셜 쪽 이메일이 인증됐더라도
 * 인증되지 않은 기존 사용자와는 묶지 않는다(`oauth2/link-account.mjs`의
 * `handleOAuthUserInfo`). 기본값에 기대지 않고 명시해, 누가 끄면 테스트가 잡도록 한다.
 *
 * `disableImplicitLinking`은 쓰지 않는다. 이미 연결된 소셜 계정의 재로그인은 이 검사를
 * 거치지 않아 기존 소셜 사용자에게 영향이 없고, 인증된 이메일끼리의 소셜 간 연결도 유지된다.
 * 대가로 선점된 주소의 실제 주인은 소셜 로그인으로 들어오지 못한다. 비밀번호 재설정이
 * 없는 지금은 이쪽이 안전하다.
 *
 * 네이버 이메일은 인증 여부를 알 수 없어 인증되지 않은 것으로 본다(`buildNaverUser`). 그래서
 * 네이버 로그인은 같은 이메일의 기존 계정에 묶이지 않고, 네이버로 처음 만든 계정에도 다른
 * 소셜 로그인이 묶이지 않는다.
 */
export const ACCOUNT_LINKING = {
  enabled: true,
  requireLocalEmailVerified: true,
} as const;

function buildAuth(env: Bindings) {
  const enabled = new Set(configuredSocialProviders(env));
  const socialProviders: Record<string, unknown> = {};

  if (enabled.has("kakao")) {
    socialProviders.kakao = {
      clientId: env.KAKAO_CLIENT_ID as string,
      clientSecret: env.KAKAO_CLIENT_SECRET as string,
      mapProfileToUser: (profile: KakaoProfileLike) => buildKakaoUser(profile),
    };
  }

  if (enabled.has("naver")) {
    socialProviders.naver = {
      clientId: env.NAVER_CLIENT_ID as string,
      clientSecret: env.NAVER_CLIENT_SECRET as string,
      mapProfileToUser: (profile: NaverProfileLike) => buildNaverUser(profile),
    };
  }

  if (enabled.has("google")) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      prompt: "select_account",
    };
  }

  return betterAuth({
    appName: APP_NAME,
    basePath: "/api/auth",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: firestoreAdapter(env.DB),
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    rateLimit: { enabled: true, customRules: RATE_LIMIT_RULES },
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    account: { accountLinking: ACCOUNT_LINKING },
    socialProviders,
    disabledPaths: ["/update-user"],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: { name: toDisplayName(user.name) },
          }),
        },
        update: {
          before: async (data) =>
            data.name === undefined
              ? undefined
              : { data: { name: toDisplayName(data.name) } },
        },
      },
    },
    plugins: process.env.NODE_ENV === "production" ? [] : [devSignIn()],
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      database: {
        generateId: () => generateUserId(),
      },
    },
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;

/**
 * 요청마다 Better Auth 인스턴스를 만든다.
 *
 * - `basePath`는 `index.ts`의 마운트 경로와 같아야 한다. API는 Next.js의
 *   `src/app/api/[[...route]]` 라우트가 받으므로, `/auth/*`로 옮기면 페이지 라우트가
 *   가로채 로그인이 조용히 깨진다.
 * - rate limit은 `NODE_ENV=production`에서만 기본으로 켜지므로 개발·테스트에서도 같게
 *   명시적으로 켠다. 저장소가 인스턴스 메모리라 부분 방어다.
 * - 사용자 이름은 저장하기 전에 `toDisplayName`으로 다듬는다(50자, 보이는 글자가 없으면
 *   기본 이름). 이 이름은 다른 사용자의 곡(원작 표시)·공유 라이브러리 카드·공유받은
 *   프레젠테이션에 복사되는데, Better Auth는 가입 이름의 길이도, `update-user` 본문의 타입도
 *   검사하지 않는다. 거절하지 않고 다듬어서 긴 소셜 프로필 이름으로도 로그인이 막히지 않는다.
 *   앱이 부르지 않는 `/update-user`는 막는다(404).
 */
export function getAuth(env: Bindings): AuthInstance {
  return buildAuth(env);
}
