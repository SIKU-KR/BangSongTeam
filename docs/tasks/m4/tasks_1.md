# Goal: [M4-1] PWA 및 배경 영상 오프라인 캐시 기반 (Service Worker + Workbox)

> **2026-09-24 범위 변경**: 발표자 보기(조작 창·청중 창·BroadcastChannel 동기화)는 MVP에서 제거됐다. 송출은 전체화면 `/present/:id/fullscreen` 한 가지다. 이 문서의 발표자 보기 관련 부분은 이력으로 남긴다.

> **마일스톤**: M4 (오프라인 및 발표자 보기)
> **태스크 번호**: `tasks_1.md`
> **선행 조건**: `docs/tasks/m3/tasks_7.md` 완료 (계정·서버 저장, 개발자 로그인)
> **목표**: 앱 셸·번들 웹폰트·배경 MP4를 브라우저 저장소에 얹어, 예배 중 `/api/media/*` 요청이 네트워크에 나가지 않게 하는 Service Worker 계층을 만든다
> **완료 기준 (DoD)**: 빌드 산출물에 `sw.js`와 `manifest.webmanifest`가 포함되고, Service Worker가 `/api/media/*`를 `worship-videos-cache`에서 Range 지원으로 서빙한다

> **구현 현황 (2026-09-22)**
>
> - Task 1.1~1.7 완료. 전체 **544개 / 73파일 Green**.
> - **설계에서 바뀐 것 1 — 폰트를 프리캐시하지 않는다.** 원안대로 `globPatterns`에 `woff2`를 넣었더니 프리캐시가 **884개 / 33MB**가 됐다. Pretendard 정적 9종과 Noto Sans KR의 유니코드 서브셋 수백 개가 모두 빌드 산출물에 있기 때문이다. 앱 셸만 프리캐시(**11개 / 1.2MB**)하고, 폰트는 `worship-fonts-cache` 런타임 캐시(CacheFirst, 1년)로 실제 쓰인 서브셋만 담는다. 세트에 쓰인 글꼴을 미리 데우는 일은 `tasks_2.md`의 준비 화면이 맡는다.
> - **설계에서 바뀐 것 2 — `vite.config.ts`가 `@repo/shared`를 import하지 못한다.** Vite 설정 로더는 워크스페이스 패키지를 외부 모듈로 두고 Node ESM으로 읽는데, `@repo/shared`는 확장자 없는 TS 소스를 export해서 `ERR_MODULE_NOT_FOUND`가 난다. 값을 복제하고 `tests/pwaConfig.test.ts`로 드리프트를 막았다.
> - `sw.js`·`workbox-*.js`·`manifest.webmanifest`가 wrangler가 서빙하는 `dist/client/`에 정확히 떨어지는 것을 빌드로 확인했다. `@cloudflare/vite-plugin`과 충돌하지 않는다.
> - `media.test.ts`는 새로 만들었다. 이 라우트에는 테스트가 없었다.
> - 아이콘은 디자인 에셋이 없어 표준 라이브러리 PNG 생성 스크립트로 만들었다(16:9 스테이지 + 가사 3줄, 검정 배경). 실제 브랜드 아이콘이 생기면 교체한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **업데이트가 예배를 끊으면 안 된다**: `registerType`은 `autoUpdate`가 아니라 `prompt`다. 자동 갱신은 배포가 나간 순간 송출 중인 페이지를 새로고침할 수 있다. 갱신 안내는 편집 화면에서만 띄우고 `/present/*`에서는 절대 띄우지 않는다.
2. **generateSW 전략을 쓴다**: TECH_SPEC §5.4-2의 스니펫은 함수형 `urlPattern`과 `new RangeRequestsPlugin()` 인스턴스를 쓰는데, 이는 `injectManifest`에서만 동작한다. generateSW는 설정을 직렬화하므로 선언형 옵션(`rangeRequests: true`, `cacheableResponse`, `expiration`)으로 옮기고 **TECH_SPEC을 고친다**(`tasks_5.md`).
3. **캐시 이름은 한 곳에서만 정의한다**: Workbox 런타임 캐시와 예배 준비 화면이 같은 Cache Storage를 공유하므로 `MEDIA_CACHE_NAME`을 `@repo/shared` 상수로 두고 양쪽이 그것만 읽는다.
4. **오프라인 새로고침이 죽으면 안 된다**: `navigateFallback`이 없으면 네트워크가 끊긴 상태에서 `/present/...`를 새로고침할 때 앱 자체가 뜨지 않는다. `/api/*`는 폴백 대상에서 제외한다.
5. **외부 CDN 금지**: 폰트는 이미 npm 번들이다(`pretendard`, `@fontsource/*`). 프리캐시 glob에 `woff2`를 포함해 오프라인에서도 같은 글꼴이 나오게 한다.
6. **DB 직접 임포트 금지·타입 단일 원천**: 기존 규칙 그대로.

---

## 2. 세부 작업 체크리스트

- [x] **Task 1.1: vite-plugin-pwa 및 Workbox 설치**
  - **대상 파일**: `apps/web/package.json`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `vite-plugin-pwa@^1.3.0`, `workbox-build@^7.4.1`, `workbox-window@^7.4.1`을 devDependencies에 추가
    - **1.3.0이 Vite 8 peer(`^8.0.0`)를 지원하는 첫 버전이다.** 1.2.0 이하는 `^7.0.0`까지만 허용하므로 설치 시 peer 경고가 난다
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 1.2: 오프라인 캐시 상수 정의**
  - **대상 파일**: `packages/shared/src/constants/projection.ts`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - `MEDIA_CACHE_NAME = "worship-videos-cache"` — Workbox `runtimeCaching.cacheName`과 예배 준비 화면이 공유한다
    - `MEDIA_URL_PREFIX = "/api/media/"` — 캐시 규칙과 URL 생성기가 같은 값을 본다
    - `PROJECTION_CHANNEL_NAME = "worship-projection"` — 지금까지 TECH_SPEC 산문에만 있던 채널명을 코드로 승격(`tasks_3.md`에서 사용)
    - `HEARTBEAT_INTERVAL_MS`, `AUDIENCE_TIMEOUT_MS`, `INVALID_JUMP_TOAST_MS = 2000`(PRD §5 '없는 번호 알림 2초')
    - `packages/shared/src/constants/index.ts`에서 re-export
  - **DoD (통과 기준)**: `pnpm exec vitest run packages/shared/src/constants/projection.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.3: 미디어 프록시 `Cache-Control` 헤더 추가**
  - **대상 파일**: `apps/web/worker/routes/media.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - 200·206 응답 양쪽에 `Cache-Control: public, max-age=31536000, immutable`을 붙인다 (TECH_SPEC §5.4-1이 요구하는데 현재 코드에 없다)
    - R2 키는 불변 자산이므로 만료를 길게 잡아도 안전하다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/worker/routes/media.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.4: PWA 아이콘 및 정적 자산 디렉토리 생성**
  - **대상 파일**: `apps/web/public/icons/*`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `apps/web/public/`이 아예 없으므로 새로 만든다
    - `icon-192.png`, `icon-512.png`, `maskable-512.png` 생성. 디자인 에셋이 없으므로 검정 배경 + 흰 글리프의 단순 아이콘을 스크립트로 생성한다
    - 송출 화면과 같은 검정 계열을 쓴다 (PRD §6.5: 송출 화면은 테마와 무관하게 검정)
  - **DoD (통과 기준)**: `ls apps/web/public/icons/`에 3개 PNG가 존재하고 `file` 결과가 유효한 PNG다.

- [x] **Task 1.5: vite-plugin-pwa 설정 (generateSW + RangeRequests)**
  - **대상 파일**: `apps/web/vite.config.ts`
  - **선행 조건**: Task 1.1, 1.2, 1.4
  - **구현 내용**:
    - `VitePWA({ registerType: "prompt", ... })`를 `react()`·`cloudflare()` 뒤에 추가
    - `workbox.globPatterns`에 `woff2`·`webp`를 포함, `maximumFileSizeToCacheInBytes` 상향
    - `workbox.navigateFallback: "index.html"`, `navigateFallbackDenylist: [/^\/api\//]`
    - `runtimeCaching`: `/api/media/*`를 `CacheFirst` + `cacheName: MEDIA_CACHE_NAME` + `rangeRequests: true` + `cacheableResponse: { statuses: [200, 206] }` + `expiration: { maxEntries: 30, maxAgeSeconds: 2592000 }`
    - `manifest`: 이름·`theme_color`/`background_color` 검정·`display: standalone`·`start_url: "/presentations"`·Task 1.4 아이콘
    - **빌드 산출 위치 확인 필수**: `build.outDir`은 `dist`인데 wrangler는 `./dist/client`를 서빙한다(`@cloudflare/vite-plugin`이 `client/` 하위를 만든다). `sw.js`가 `dist/client/`에 떨어지지 않으면 `VitePWA({ outDir })`로 맞춘다
  - **DoD (통과 기준)**: `pnpm --filter web build` 후 `apps/web/dist/client/sw.js`와 `manifest.webmanifest`가 존재하고 `sw.js`에 `worship-videos-cache`가 포함된다.

- [x] **Task 1.6: Service Worker 등록 및 갱신 알림 스토어**
  - **대상 파일**: `apps/web/src/pwa/registerServiceWorker.ts`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - `virtual:pwa-register`의 `registerSW`를 `onNeedRefresh`/`onOfflineReady` 콜백과 함께 호출하고, 결과를 외부 스토어(`useSyncExternalStore` 패턴, `persistenceStatus.ts`와 동일 형태)로 노출
    - **자동 새로고침을 하지 않는다.** 갱신 적용은 사용자가 버튼을 눌렀을 때만
    - 테스트 환경(jsdom)과 SSR 안전 가드: `navigator.serviceWorker`가 없으면 조용히 no-op
    - `apps/web/src/vite-env.d.ts`에 `/// <reference types="vite-plugin-pwa/client" />` 추가
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/pwa/registerServiceWorker.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.7: 앱 부팅에 SW 등록 결합 및 갱신 배너**
  - **대상 파일**: `apps/web/src/main.tsx`, `apps/web/src/components/common/AppUpdateBanner.tsx`
  - **선행 조건**: Task 1.6
  - **구현 내용**:
    - `main.tsx`에서 `registerServiceWorker()` 호출
    - `AppUpdateBanner`: 새 버전이 대기 중일 때만 노출, '지금 새로고침' 버튼. **`/present/`로 시작하는 경로에서는 렌더하지 않는다**
    - `AppShellLayout`에만 붙이고 송출 라우트에는 붙이지 않는다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/components/common/AppUpdateBanner.test.tsx`가 100% 통과(Green)한다.

---

## 3. 검증 명령어

```bash
pnpm --filter web build && ls -la apps/web/dist/client/sw.js apps/web/dist/client/manifest.webmanifest
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_2.md`(M4-2)에서 이 캐시에 실제로 영상을 채워 넣는 '예배 준비' 화면과 영구 저장소 요청을 붙인다.
