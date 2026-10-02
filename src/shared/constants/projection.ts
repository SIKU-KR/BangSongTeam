/**
 * 송출(Projection) 계층 공용 상수.
 *
 * 오프라인 캐시는 브라우저 코드와 빌드 설정(`vite.config.ts`) 양쪽에서 같은
 * 값을 봐야 한다. 캐시 이름이 한 글자라도 어긋나면 예배 당일에 배경이 안
 * 나온다. 그래서 `vite.config.ts`가 이 파일을 상대 경로로 직접 import한다.
 * Vite 설정 로더가 함께 번들하므로 이 파일은 다른 모듈을 import하지 않는다.
 */

/**
 * 배경 영상·이미지 원본의 Workbox 런타임 캐시 이름.
 * Service Worker의 runtimeCaching과 백그라운드 캐시
 * (`src/client/lib/offline/mediaCache.ts`)의 `caches.open()`이 같은 캐시를 쓴다.
 *
 * 개수 한도를 두지 않는다. 배경 하나가 수백 MB일 수 있어 개수로는 용량을 다룰 수
 * 없고, 한도에 걸려 송출할 세트의 영상이 밀려나면 안 된다. 용량이 모자라면 앱이
 * 지금 세트 밖의 영상부터 지운다.
 */
export const MEDIA_CACHE_NAME = "worship-videos-cache";

/**
 * 배경 포스터(목록·썸네일용 축소 이미지)의 런타임 캐시 이름.
 * 라이브러리를 훑으면 포스터 수백 장이 담기므로 영상과 캐시를 나눈다. 같은 캐시에
 * 두면 포스터가 개수 한도를 채워 송출용 영상을 밀어낸다.
 */
export const POSTER_CACHE_NAME = "worship-posters-cache";

/**
 * 배경 영상·포스터를 중계하는 동일 출처 프록시 경로 접두사.
 * 배경 URL은 `mediaUrlForKey`가 이 값으로 만든다. R2 커스텀 도메인 직통으로
 * 바꾸게 되면 이 값과 Workbox `urlPattern`만 바뀐다.
 */
export const MEDIA_URL_PREFIX = "/api/media/";

/** 포스터 R2 키 접두사를 포함한 프록시 경로 */
export const POSTER_URL_PREFIX = `${MEDIA_URL_PREFIX}posters/`;

/** 미디어 URL이 담기는 런타임 캐시. Workbox `urlPattern`과 같은 기준으로 나눈다 */
export function mediaCacheNameFor(url: string): string {
  return url.startsWith(POSTER_URL_PREFIX)
    ? POSTER_CACHE_NAME
    : MEDIA_CACHE_NAME;
}

/** 눈누 카탈로그 글꼴(외부 CDN)의 Workbox 런타임 캐시 이름 */
export const CDN_FONT_CACHE_NAME = "worship-cdn-fonts-cache";

/**
 * 눈누 카탈로그 글꼴 CSS·파일을 내려 주는 외부 CDN 주소.
 *
 * Workbox `RegExpRoute`는 다른 출처 URL이면 정규식이 URL의 첫 글자부터 맞아야만
 * 처리한다(`result.index !== 0`이면 건너뜀, workbox-routing `RegExpRoute.js`). 그래서
 * `^https://`로 고정한다. 확장자만 보는 정규식은 다른 출처에서 늘 빗나가 오프라인
 * 송출이 대체 글꼴로 바뀐다. Google CSS가 가리키는 `fonts.gstatic.com`처럼 CSS 안에서
 * 받는 호스트도 담아야 한다. 카탈로그에 새 호스트가 생기면 테스트가 실패한다.
 */
export const CDN_FONT_URL_PATTERN =
  /^https:\/\/(?:(?:cdn|fastly|gcore)\.jsdelivr\.net|fonts\.(?:googleapis|gstatic)\.com|hangeul\.pstatic\.net|cdn\.noonnu\.cc|cdn\.df\.nexon\.com|spoqa\.github\.io|raw\.githubusercontent\.com)\//i;
