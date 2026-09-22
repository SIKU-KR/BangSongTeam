/**
 * Cloudflare Worker Bindings and Context Types for Hono.
 */
export interface Bindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  AI: Ai;
  R2_PUBLIC_DOMAIN?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  /**
   * 개발자 로그인 스위치. 로컬에서만 "true"로 둔다.
   * **운영 시크릿에 절대 넣지 않는다** — 누구나 아무 계정으로 로그인하게 된다.
   */
  DEV_LOGIN_ENABLED?: string;
}

export interface Variables {
  userId?: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
