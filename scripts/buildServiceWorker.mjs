/**
 * `next build` 뒤에 오프라인 송출용 서비스 워커(`public/sw.js`)를 만든다.
 *
 * - 앱 셸만 프리캐시한다: `/_next/static`의 JS·CSS, PWA 아이콘, 그리고 화면별로 미리 렌더한
 *   HTML 셸. 글꼴을 여기 넣으면 수십 MB짜리 설치가 된다 — Pretendard·Noto Sans KR·나눔명조의
 *   유니코드 서브셋 수백 개가 모두 빌드 산출물에 있기 때문이다. 번들 글꼴과 눈누 카탈로그의
 *   CDN 글꼴 모두 아래 runtimeCaching으로 실제 쓰인 것만 담고, 세트를 열면 백그라운드 캐시가
 *   가사에 쓰인 글꼴을 불러 캐시를 데운다.
 * - 화면 이동은 언제나 프리캐시한 셸로 답한다(`public/sw-shell.js`). 서버는 어느 화면이든
 *   로딩 화면만 그리므로 셸이 서버 응답과 같고, 네트워크가 끊긴 상태에서 `/present/...`를
 *   새로고침해도 앱이 뜬다. 동적 경로 셸은 `OFFLINE_SHELL_PARAM` 자리를 실제 값으로 바꾼다.
 * - 앱 안 이동(`router.push`)이 서버에 묻는 RSC 응답도 화면별로 미리 렌더한 `.rsc`를
 *   `public/offline-rsc/`에 복사해 프리캐시하고, 서버에 닿지 못하면 그것으로 답한다
 *   (`shellWorkerSource`).
 * - `skipWaiting`을 켜지 않는다. 배포가 나간 순간 송출 중인 페이지가 새 버전으로 바뀌면
 *   예배가 끊긴다. 새 버전은 사용자가 송출 화면이 아닌 곳을 새로고침할 때 적용한다
 *   (`src/client/pwa/registerServiceWorker.ts`).
 * - `clientsClaim`: 처음 설치된 SW가 곧바로 지금 페이지를 제어해 첫 방문에도 배경 영상을
 *   캐시본으로 재생한다.
 * - generateSW는 설정을 직렬화하므로 함수형 urlPattern과 `new RangeRequestsPlugin()`
 *   인스턴스를 쓸 수 없어 선언형 등가 옵션(`rangeRequests`, `cacheableResponse`,
 *   `expiration`)을 쓴다.
 * - 배경 영상 캐시는 편집·송출 중 백그라운드 캐시(`src/client/lib/offline/mediaCache.ts`)가
 *   직접 써 넣는 캐시와 같아야 하므로, 이름과 경로를 공용 상수에서 가져온다.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSW } from "workbox-build";
import {
  CDN_FONT_CACHE_NAME,
  CDN_FONT_STYLESHEET_CACHE_NAME,
  CDN_FONT_STYLESHEET_PATTERN,
  CDN_FONT_URL_PATTERN,
  MEDIA_CACHE_NAME,
  MEDIA_URL_PREFIX,
  OFFLINE_SHELL_PARAM,
  POSTER_CACHE_NAME,
  POSTER_URL_PREFIX,
} from "../src/shared/constants/projection.ts";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const NEXT_DIR = path.join(ROOT_DIR, ".next");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SHELL_SCRIPT = "sw-shell.js";

/** 셸로 답하지 않는 Next.js 내부 페이지 */
const INTERNAL_ROUTES = new Set(["/_not-found", "/_global-error"]);

/**
 * 화면별로 미리 렌더한 RSC(`.next/server/app/*.rsc`)를 복사해 두는 공개 경로. 프리캐시는
 * 서버에서 받아야 하는데, 서버는 `.rsc` 주소를 그 화면의 RSC로 답하지 않는다.
 */
export const OFFLINE_RSC_PREFIX = "/offline-rsc";

/**
 * 앱 안 이동의 RSC 요청이 서버 응답을 기다리는 최대 시간. 넘기면 셸 RSC로 답한다.
 * 연결은 됐는데 응답이 오지 않는 와이파이에서 송출 버튼을 눌러도 한참 아무 일도 일어나지
 * 않는 것을 막는다. 서버도 로딩 화면만 그려 셸 RSC와 같은 응답을 주므로 일찍 끊어도 잃는
 * 것이 없다.
 */
export const RSC_NETWORK_TIMEOUT_MS = 3000;

/**
 * 미리 렌더한 HTML 셸 목록. 동적 경로는 `OFFLINE_SHELL_PARAM`으로 한 장씩 렌더돼 있다.
 * 한 경로에 동적 자리가 둘 이상이면 어느 값을 어디에 넣을지 알 수 없어 빌드를 멈춘다.
 * `rsc`는 같은 셸의 RSC 파일(prerender manifest의 `dataRoute`)이다.
 */
export function collectShells(prerenderRoutes, placeholder) {
  const shells = [];
  for (const [route, info] of Object.entries(prerenderRoutes)) {
    if (INTERNAL_ROUTES.has(route) || !info.dataRoute) continue;
    const segments = route.split("/").filter(Boolean);
    const dynamicCount = segments.filter((s) => s === placeholder).length;
    if (dynamicCount > 1) {
      throw new Error(
        `동적 자리가 둘 이상인 화면은 셸로 만들 수 없습니다: ${route}`,
      );
    }
    const file = route === "/" ? "index.html" : `${route.slice(1)}.html`;
    shells.push({ route, segments, file, rsc: info.dataRoute });
  }
  return shells;
}

/**
 * 주소에 맞는 셸과 동적 자리에 넣을 값. 정적 화면이 동적 화면보다 먼저 맞는다
 * (`/presentations/trash`는 폴더 화면이 아니다). 값이 경로 안전 문자가 아니면 셸 HTML에
 * 그대로 넣을 수 없어 맞지 않은 것으로 본다.
 *
 * 서비스 워커에도 그대로 직렬화되므로 바깥 값을 참조하지 않는다.
 */
export function matchShell(pathname, shells, placeholder) {
  const segments = pathname.split("/").filter(Boolean);
  if (pathname !== "/" && pathname.endsWith("/")) return null;
  const exact = shells.find(
    (shell) =>
      !shell.segments.includes(placeholder) && shell.route === pathname,
  );
  if (exact) return { route: exact.route, value: null };
  for (const shell of shells) {
    if (shell.segments.length !== segments.length) continue;
    let value = null;
    const matches = shell.segments.every((segment, index) => {
      const actual = segments[index];
      if (segment !== placeholder) return segment === actual;
      if (!/^[A-Za-z0-9_-]+$/.test(actual)) return false;
      value = actual;
      return true;
    });
    if (matches && value !== null) return { route: shell.route, value };
  }
  return null;
}

/**
 * 화면 이동 요청을 프리캐시한 셸로 답하는 fetch 핸들러(`public/sw-shell.js`)의 소스.
 * generateSW가 만드는 Workbox 라우트보다 먼저 등록되도록 `importScripts`로 붙는다.
 *
 * - 주소창 이동(`navigate`)은 언제나 셸 HTML로 답한다.
 * - 앱 안 이동(`router.push`)의 RSC 요청은 서버에 먼저 묻고, 닿지 못하거나 RSC가 아닌
 *   응답(프록시·서버 오류 페이지)이 오거나 `RSC_NETWORK_TIMEOUT_MS` 안에 답이 없으면 셸
 *   RSC로 답한다. Next.js는 RSC 요청이 실패하면 브라우저 이동(전체 새로고침)으로 넘어가는데,
 *   그러면 송출을 시작할 때 들어간 전체화면이 풀리고 메모리에만 있는 동기화 큐가 사라진다.
 *   셸 RSC는 같은 빌드에서 나와 빌드 id가 페이지와 같다.
 * - 미리 받기(prefetch) 요청은 응답 형식이 달라 답하지 않는다. 실패해도 Next.js가 이동할 때
 *   위의 RSC 요청을 다시 보낸다.
 */
export function shellWorkerSource(shells, placeholder) {
  const shellRscPaths = Object.fromEntries(
    shells.map(({ route, rsc }) => [route, OFFLINE_RSC_PREFIX + rsc]),
  );
  return `/* 빌드 산출물: scripts/buildServiceWorker.mjs */
const SHELLS = ${JSON.stringify(shells.map(({ route, segments }) => ({ route, segments })))};
const SHELL_RSC_PATHS = ${JSON.stringify(shellRscPaths)};
const PLACEHOLDER = ${JSON.stringify(placeholder)};
const PRECACHE = "workbox-precache-v2-" + self.registration.scope;
const RSC_CONTENT_TYPE = "text/x-component";
const RSC_NETWORK_TIMEOUT_MS = ${RSC_NETWORK_TIMEOUT_MS};
const matchShell = ${matchShell.toString()};

function precached(pathname) {
  return caches.match(new URL(pathname, self.location.origin).href, {
    cacheName: PRECACHE,
    ignoreSearch: true,
  });
}

function fillPlaceholder(text, shell) {
  return shell.value === null ? text : text.split(PLACEHOLDER).join(shell.value);
}

async function serveShell(request, shell) {
  const cached = await precached(shell.route);
  if (!cached) return fetch(request);
  if (shell.value === null) return cached;
  const html = fillPlaceholder(await cached.text(), shell);
  const headers = new Headers(cached.headers);
  headers.delete("content-length");
  return new Response(html, { status: 200, headers });
}

async function shellRsc(shell) {
  const cached = await precached(SHELL_RSC_PATHS[shell.route]);
  if (!cached) return null;
  return new Response(fillPlaceholder(await cached.text(), shell), {
    status: 200,
    headers: { "content-type": RSC_CONTENT_TYPE },
  });
}

function isFlightResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  return response.ok && contentType.startsWith(RSC_CONTENT_TYPE);
}

async function serveRsc(request, shell) {
  let timer;
  const network = fetch(request).catch(() => null);
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), RSC_NETWORK_TIMEOUT_MS);
  });
  const answered = await Promise.race([network, timedOut]);
  clearTimeout(timer);
  if (answered && isFlightResponse(answered)) return answered;
  const fallback = await shellRsc(shell);
  if (fallback) return fallback;
  return answered || (await network) || Response.error();
}

function isRscNavigation(request) {
  return (
    request.headers.get("RSC") === "1" &&
    !request.headers.has("Next-Router-Prefetch") &&
    !request.headers.has("Next-Router-Segment-Prefetch")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const isNavigation = request.mode === "navigate";
  if (!isNavigation && !isRscNavigation(request)) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const shell = matchShell(url.pathname, SHELLS, PLACEHOLDER);
  if (!shell) return;
  event.respondWith(isNavigation ? serveShell(request, shell) : serveRsc(request, shell));
});
`;
}

function copyShellRscFiles(shells) {
  const dir = path.join(PUBLIC_DIR, OFFLINE_RSC_PREFIX);
  rmSync(dir, { recursive: true, force: true });
  for (const shell of shells) {
    const target = path.join(dir, shell.rsc);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(NEXT_DIR, "server/app", shell.rsc), target);
  }
}

function revisionOf(file) {
  return createHash("md5").update(readFileSync(file)).digest("hex");
}

async function main() {
  const manifest = JSON.parse(
    readFileSync(path.join(NEXT_DIR, "prerender-manifest.json"), "utf-8"),
  );
  const shells = collectShells(manifest.routes, OFFLINE_SHELL_PARAM);
  const shellScript = shellWorkerSource(shells, OFFLINE_SHELL_PARAM);
  writeFileSync(path.join(PUBLIC_DIR, SHELL_SCRIPT), shellScript);
  copyShellRscFiles(shells);

  const { count, size, warnings } = await generateSW({
    swDest: path.join(PUBLIC_DIR, "sw.js"),
    globDirectory: ROOT_DIR,
    globPatterns: [".next/static/**/*.{js,css}", "public/icons/*.png"],
    modifyURLPrefix: { ".next/static/": "/_next/static/", "public/": "/" },
    dontCacheBustURLsMatching: /^\/_next\/static\//,
    additionalManifestEntries: [
      ...shells.map((shell) => ({
        url: shell.route,
        revision: revisionOf(path.join(NEXT_DIR, "server/app", shell.file)),
      })),
      ...shells.map((shell) => ({
        url: OFFLINE_RSC_PREFIX + shell.rsc,
        revision: revisionOf(path.join(NEXT_DIR, "server/app", shell.rsc)),
      })),
      {
        url: "/manifest.webmanifest",
        revision: revisionOf(
          path.join(NEXT_DIR, "server/app/manifest.webmanifest.body"),
        ),
      },
    ],
    importScripts: [`/${SHELL_SCRIPT}`],
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    runtimeCaching: [
      {
        // 눈누 카탈로그 글꼴 CSS (jsDelivr, Google Fonts 등 외부 CDN).
        // <link>로 붙인 CSS는 불투명 응답(status 0)이라 오류 응답도 그대로 담긴다.
        // 캐시본으로 바로 그리되 온라인이면 뒤에서 다시 받아, 한 번 담긴 오류가
        // 다음 로드에서 바뀌게 한다.
        urlPattern: CDN_FONT_STYLESHEET_PATTERN,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: CDN_FONT_STYLESHEET_CACHE_NAME,
          cacheableResponse: { statuses: [0, 200] },
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          },
        },
      },
      {
        // 눈누 카탈로그 글꼴 파일. Workbox는 다른 출처 URL을 정규식이 첫 글자부터
        // 맞을 때만 처리하므로 아래 확장자 규칙으로는 잡히지 않는다. 패턴은 공용
        // 상수에서 가져온다. @font-face 요청은 CORS라 실제 상태 코드가 보이므로
        // 200만 담는다. Google CSS 하나가 유니코드 서브셋 100개 안팎으로
        // 펼쳐지므로 한도를 넉넉히 둔다.
        // purgeOnQuotaError를 켜지 않는다. 배경 영상 저장이 용량 오류를 내면 모든
        // 런타임 캐시의 콜백이 불려 송출 글꼴 캐시가 통째로 지워진다.
        urlPattern: CDN_FONT_URL_PATTERN,
        handler: "CacheFirst",
        options: {
          cacheName: CDN_FONT_CACHE_NAME,
          cacheableResponse: { statuses: [200] },
          expiration: {
            maxEntries: 1000,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          },
        },
      },
      {
        // 번들 웹폰트 (Pretendard, Noto Sans KR, Nanum Myeongjo).
        // 자체 오리진 /_next/static/media/ 에서 온다. 확장자만 보는 이 규칙은 같은
        // 출처에만 맞는다. 서브셋 파일은 Pretendard Variable 92개, Noto Sans KR 248개,
        // 나눔명조 184개다.
        // 한도가 이보다 작으면 가사에 쓴 서브셋이 밀려나 오프라인 송출에서
        // 대체 글꼴로 나올 수 있으므로 전부 담을 수 있게 둔다.
        urlPattern: /\.(?:woff2?|ttf|otf|eot)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "worship-fonts-cache",
          cacheableResponse: { statuses: [0, 200] },
          expiration: {
            maxEntries: 600,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          },
        },
      },
      {
        // 글꼴 드롭다운 미리보기 이미지 (1,163장). 프리캐시하면 설치 때 전부 받으므로
        // 본 것만 담는다. 드롭다운을 다시 열 때 재검증 요청 수십 건이 나가지 않는다.
        urlPattern: /\/font-previews\/[^/]+\.webp$/,
        handler: "CacheFirst",
        options: {
          cacheName: "worship-font-previews-cache",
          cacheableResponse: { statuses: [200] },
          expiration: {
            maxEntries: 1500,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          },
        },
      },
      {
        // 포스터는 영상보다 먼저 맞춰 따로 담는다. 라이브러리를 훑으며 쌓이는
        // 포스터가 영상 캐시를 밀어내지 않게 하기 위해서다.
        urlPattern: new RegExp(POSTER_URL_PREFIX, "i"),
        handler: "CacheFirst",
        options: {
          cacheName: POSTER_CACHE_NAME,
          cacheableResponse: { statuses: [200] },
          expiration: {
            maxEntries: 500,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          },
        },
      },
      {
        urlPattern: new RegExp(MEDIA_URL_PREFIX, "i"),
        handler: "CacheFirst",
        options: {
          cacheName: MEDIA_CACHE_NAME,
          // = RangeRequestsPlugin. 캐시된 전체 응답을 잘라 206을 만들어
          // <video>의 구간 재생을 네트워크 없이 처리한다.
          rangeRequests: true,
          // 전체 응답(200)만 담는다. Cache API는 206을 저장하지 못해
          // (`cache.put`이 TypeError), 허용해 봐야 SW에서 에러만 난다.
          cacheableResponse: { statuses: [200] },
          // 개수·기간 한도는 두지 않는다. 용량은 앱이 바이트 기준으로 관리한다
          // (`ensureMediaSpace`).
        },
      },
    ],
  });

  for (const warning of warnings) console.warn(warning);
  console.log(
    `서비스 워커: 셸 ${shells.length}개 포함 ${count}개 파일(${(size / 1024 / 1024).toFixed(1)} MB) 프리캐시`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
