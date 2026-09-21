/**
 * Cloudflare Worker Bindings and Context Types for Hono.
 */
export interface Bindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  AI: Ai;
  QUEUE: Queue;
  R2_PUBLIC_DOMAIN?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
}

export interface Variables {
  userId?: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
