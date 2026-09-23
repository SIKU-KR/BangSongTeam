/**
 * Cloudflare Worker Bindings and Context Types for Hono.
 */
export interface Bindings {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  AI: Ai;
  /**
   * Workers AI 호출을 거칠 AI Gateway id (선택). 설정하면 호출 로그·요청 제한·
   * 월 비용 상한을 Gateway에서 관리한다 (PRD 9장 LLM 호출 비용).
   */
  AI_GATEWAY_ID?: string;
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
