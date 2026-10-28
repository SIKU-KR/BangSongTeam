import type { Db } from "#db";
import type { MediaStore } from "./lib/mediaStore";

/**
 * API 앱이 요청마다 받는 바깥 자원과 비밀값. 운영·개발은 `env.ts`가 프로세스 환경 변수로
 * 한 번 만들고, 테스트는 에뮬레이터 Firestore와 메모리 미디어 저장소를 넣는다.
 */
export interface Bindings {
  DB: Db;
  MEDIA: MediaStore;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 앞단 Cloudflare Worker와 나눠 가진 비밀값. 있을 때만 프록시가 넘긴 사용자 IP를 믿는다 */
  PROXY_SECRET?: string;
  /**
   * 켜면 `PROXY_SECRET`이 맞는 요청만 받는다(비밀값 헤더 없는 `/api/health` 제외). run.app
   * 주소로 곧장 들어오는 요청을 막는 운영자 선택 사항이라 기본은 꺼짐이다
   */
  REQUIRE_PROXY?: boolean;
}

export interface Variables {
  userId?: string;
  /** 요청 상관 ID. `requestLog` 미들웨어가 정하고 응답의 `x-request-id`로도 내보낸다 */
  requestId?: string;
  /** 이 요청의 Cloud Logging trace 이름. 모르면 없다(`cloudTraceName`) */
  logTrace?: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
