/**
 * 송출(Projection) 계층 공용 상수.
 *
 * 오프라인 캐시와 발표자 보기는 브라우저 코드와 빌드 설정(`vite.config.ts`)
 * 양쪽에서 같은 값을 봐야 한다. 캐시 이름이나 채널 이름이 한 글자라도 어긋나면
 * 예배 당일에 배경이 안 나오거나 송출 창이 조작 창을 못 따라간다.
 */

/**
 * Workbox 런타임 캐시 이름.
 * `vite.config.ts`의 runtimeCaching.cacheName과 예배 준비 화면의
 * `caches.open()`이 반드시 같은 값을 써야 한다.
 */
export const MEDIA_CACHE_NAME = "worship-videos-cache";

/**
 * 배경 영상·포스터를 중계하는 동일 출처 프록시 경로 접두사 (TECH_SPEC 5.4-1).
 * R2 커스텀 도메인 직통으로 바꾸게 되면 이 값과 `getBackgroundMediaUrl`의
 * baseUrl 두 곳만 바뀐다.
 */
export const MEDIA_URL_PREFIX = "/api/media/";

/**
 * 조작 창(Controller) ↔ 송출 창(Audience) BroadcastChannel 이름 (TECH_SPEC 5.3).
 */
export const PROJECTION_CHANNEL_NAME = "worship-projection";

/**
 * 발표자 보기 동기화 타이밍 상수.
 */
export const PROJECTION_SYNC = {
  /** 조작 창·송출 창이 서로에게 살아 있음을 알리는 주기 */
  HEARTBEAT_INTERVAL_MS: 2000,
  /** 이 시간 동안 상대 창의 신호가 없으면 연결이 끊긴 것으로 본다 */
  AUDIENCE_TIMEOUT_MS: 6000,
  /** 없는 번호를 입력했을 때 조작 창에만 띄우는 알림 시간 (PRD 5) */
  INVALID_JUMP_TOAST_MS: 2000,
} as const;

/**
 * 청중 송출 창을 여는 창 이름과 모드 쿼리 파라미터.
 * 같은 이름으로 열면 이미 열린 창이 재사용된다.
 */
export const AUDIENCE_WINDOW_NAME = "WorshipAudienceWindow";
export const AUDIENCE_MODE_PARAM = "audience";
