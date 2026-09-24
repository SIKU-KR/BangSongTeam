/**
 * 송출(Projection) 계층 공용 상수.
 *
 * 오프라인 캐시는 브라우저 코드와 빌드 설정(`vite.config.ts`) 양쪽에서 같은
 * 값을 봐야 한다. 캐시 이름이 한 글자라도 어긋나면 예배 당일에 배경이 안
 * 나온다.
 */

/**
 * Workbox 런타임 캐시 이름.
 * `vite.config.ts`의 runtimeCaching.cacheName과 백그라운드 캐시
 * (`apps/web/src/lib/offline/mediaCache.ts`)의 `caches.open()`이 반드시 같은 값을 써야 한다.
 */
export const MEDIA_CACHE_NAME = "worship-videos-cache";

/**
 * 배경 영상·포스터를 중계하는 동일 출처 프록시 경로 접두사 (TECH_SPEC 5.4-1).
 * R2 커스텀 도메인 직통으로 바꾸게 되면 이 값과 `getBackgroundMediaUrl`의
 * baseUrl 두 곳만 바뀐다.
 */
export const MEDIA_URL_PREFIX = "/api/media/";
