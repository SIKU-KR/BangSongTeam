import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

/**
 * workerd 테스트 환경 바인딩 선언.
 *
 * 테스트 파일마다 따로 선언하면 바인딩이 늘어날 때 일부만 고쳐져 갈라진다.
 * 한 곳에서 선언하고 tsconfig가 포함하게 둔다.
 */
declare module "cloudflare:test" {
  interface ProvidedEnv {
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
    TEST_MIGRATIONS: D1Migration[];
  }
}
