/**
 * 송출(Projection) 계층 공용 상수.
 *
 * 오프라인 캐시는 브라우저 코드와 서비스 워커 빌드(`scripts/buildServiceWorker.mjs`)
 * 양쪽에서 같은 값을 봐야 한다. 캐시 이름이 한 글자라도 어긋나면 예배 당일에 배경이
 * 안 나온다. 그래서 빌드 스크립트가 이 파일을 Node 타입 제거로 직접 import한다.
 * 이 파일은 다른 모듈을 import하지 않는다.
 */

/**
 * 오프라인 화면 셸을 미리 렌더할 때 동적 경로 자리(`[presentationId]` 등)에 넣는 값.
 *
 * 서버는 어느 화면이든 로딩 화면만 그리므로, 동적 경로마다 이 값으로 한 장씩 미리
 * 렌더해 서비스 워커가 프리캐시한다. 오프라인에서 `/editor/abc`를 열면 서비스 워커가
 * `/editor/__shell__` 셸의 이 값을 `abc`로 바꿔 돌려준다.
 */
export const OFFLINE_SHELL_PARAM = "__shell__";

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
 * 배경 URL은 `mediaUrlForKey`가 이 값으로 만든다. GCS·CDN 직통으로
 * 바꾸게 되면 이 값과 Workbox `urlPattern`만 바뀐다.
 */
export const MEDIA_URL_PREFIX = "/api/media/";

/** 포스터 저장소 키 접두사를 포함한 프록시 경로 */
export const POSTER_URL_PREFIX = `${MEDIA_URL_PREFIX}posters/`;

/**
 * 미디어 본문 응답(200·206과 그 HEAD)이 늘 싣는 객체 전체 크기(바이트) 헤더.
 *
 * 32 MiB를 넘는 영상은 Cloud Run 응답 한도 때문에 `content-length` 없이 나간다. 이 헤더가
 * 없으면 캐시에 담긴 큰 영상의 용량을 셀 수 없어, 저장 공간을 비울 때 0바이트로 세고 SW가
 * 담지 못한 까닭도 가리지 못한다(`mediaCache`). 서비스 워커·Cloudflare 캐시는 응답 헤더를
 * 그대로 담으므로 캐시본에도 남는다.
 */
export const MEDIA_SIZE_HEADER = "x-media-size";

/**
 * 페이지가 서비스 워커에 '이 출처의 창이 몇 개 열려 있는지' 묻는 메시지의 종류(`data.type`). 답은
 * 함께 보낸 MessageChannel 포트로 돌아오고, 모양은 `WindowCountReplySchema`다.
 *
 * 창마다 쥐는 미디어 Web Lock은 이 기능을 담은 배포판의 창만 쥔다. 옛 배포판이 열어 둔 송출·편집
 * 창은 영상을 쓰면서도 잠금을 쥐지 않아, 저장한 영상을 지울 때(`clearUnusedMediaCache`) 창 수로
 * 따로 확인한다. 서비스 워커(`scripts/buildServiceWorker.mjs`)와 페이지가 같은 값을 봐야 한다.
 */
export const WINDOW_COUNT_MESSAGE = "chiton:count-windows";

/** 미디어 URL이 담기는 런타임 캐시. Workbox `urlPattern`과 같은 기준으로 나눈다 */
export function mediaCacheNameFor(url: string): string {
  return url.startsWith(POSTER_URL_PREFIX)
    ? POSTER_CACHE_NAME
    : MEDIA_CACHE_NAME;
}

/** 눈누 카탈로그 글꼴 파일(외부 CDN)의 Workbox 런타임 캐시 이름 */
export const CDN_FONT_CACHE_NAME = "worship-cdn-fonts-cache";

/**
 * 눈누 카탈로그 글꼴 CSS(외부 CDN)의 Workbox 런타임 캐시 이름.
 * `<link>`로 붙인 CSS는 불투명 응답이라 오류 응답도 status 0으로 담긴다. 그래서 글꼴
 * 파일과 캐시를 나눠 CSS만 다음 온라인 로드에서 다시 받아 바꾼다.
 */
export const CDN_FONT_STYLESHEET_CACHE_NAME = "worship-cdn-font-css-cache";

const CDN_FONT_ORIGIN = String.raw`^https:\/\/(?:(?:cdn|fastly|gcore)\.jsdelivr\.net|fonts\.(?:googleapis|gstatic)\.com|hangeul\.pstatic\.net|cdn\.noonnu\.cc|cdn\.df\.nexon\.com|spoqa\.github\.io|raw\.githubusercontent\.com)\/`;

/**
 * 눈누 카탈로그 글꼴 CSS·파일을 내려 주는 외부 CDN 주소.
 *
 * Workbox `RegExpRoute`는 다른 출처 URL이면 정규식이 URL의 첫 글자부터 맞아야만
 * 처리한다(`result.index !== 0`이면 건너뜀, workbox-routing `RegExpRoute.js`). 그래서
 * `^https://`로 고정한다. 확장자만 보는 정규식은 다른 출처에서 늘 빗나가 오프라인
 * 송출이 대체 글꼴로 바뀐다. Google CSS가 가리키는 `fonts.gstatic.com`처럼 CSS 안에서
 * 받는 호스트도 담아야 한다. 카탈로그에 새 호스트가 생기면 테스트가 실패한다.
 */
export const CDN_FONT_URL_PATTERN = new RegExp(CDN_FONT_ORIGIN, "i");

/**
 * `CDN_FONT_URL_PATTERN` 가운데 글꼴 CSS 주소(`*.css`, Google `/css?family=`).
 * Workbox 규칙에서 `CDN_FONT_URL_PATTERN`보다 먼저 맞춰야 CSS가 글꼴 파일 규칙으로
 * 새지 않는다.
 */
export const CDN_FONT_STYLESHEET_PATTERN = new RegExp(
  String.raw`${CDN_FONT_ORIGIN}(?:[^?#]*\.css|css2?)(?:[?#]|$)`,
  "i",
);
