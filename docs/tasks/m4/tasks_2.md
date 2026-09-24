# Goal: [M4-2] 예배 준비 화면 및 영구 저장소 (Worship Preparation)

> **2026-09-24 범위 변경**: 발표자 보기(조작 창·청중 창·BroadcastChannel 동기화)는 MVP에서 제거됐다. 송출은 전체화면 `/present/:id/fullscreen` 한 가지다. 이 문서의 발표자 보기 관련 부분은 이력으로 남긴다.

> **마일스톤**: M4 (오프라인 및 발표자 보기)
> **태스크 번호**: `tasks_2.md`
> **선행 조건**: `docs/tasks/m4/tasks_1.md` 완료 (Service Worker·미디어 캐시 규칙)
> **목표**: 송출 전에 세트의 배경 영상을 Cache Storage로 100% 내려받고, 영구 저장소를 요청하고, 곡별 상태와 '오프라인 송출 가능' 배지를 보여주는 준비 화면을 만든다
> **완료 기준 (DoD)**: 준비 화면에서 다운로드를 마치면 '오프라인 송출 가능' 배지가 켜지고, 네트워크를 끊어도 그 세트의 배경 영상이 재생된다

> **구현 현황 (2026-09-22)**
>
> - Task 2.1~2.8 완료. 전체 **595개 / 79파일 Green**.
> - **원안에 없던 Task 2.8(글꼴 사전 로드)을 추가했다.** `tasks_1.md`에서 폰트를 프리캐시에서 뺀 결과, 세트 글꼴의 오프라인 보장이 준비 화면 책임으로 넘어왔기 때문이다.
> - **설계에서 바뀐 것 — '지금 바로 송출' 버튼을 따로 두지 않았다.** 송출 버튼 두 개(발표자 보기·단독 전체화면)를 항상 활성 상태로 두고, 준비가 끝나지 않았을 때 그 위에 경고 문구를 띄운다. 같은 일을 하는 버튼을 셋으로 늘리면 조작자가 예배 직전에 어느 것을 눌러야 할지 헷갈린다.
> - 준비 화면은 진입 즉시 자동으로 다운로드를 시작한다(`autoStart`). 이미 캐시에 있으면 받지 않고 곧바로 '오프라인 송출 가능'으로 뜬다.
> - jsdom에 Cache Storage가 없어 `src/test/fakeCacheStorage.ts` 대역을 만들어 `setup.ts`에서 깐다. IndexedDB(`fake-indexeddb`)와 같은 자리다.
> - **실검증은 남아 있다.** 로컬 R2 버킷이 비어 있어 `/api/media/*`가 404라 이 환경에서는 실패 경로만 확인할 수 있다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **권장 관문이지 강제 관문이 아니다** (2026-09-22 결정): 송출 버튼은 준비 화면으로 먼저 보내되, 캐시가 끝나지 않아도 '지금 바로 송출'로 건너뛸 수 있다. 영상이 없다고 예배 송출 자체가 막히면 그게 더 큰 사고다.
2. **Service Worker 활성화를 기다리지 않고도 캐시가 채워져야 한다**: 첫 방문에서는 SW가 아직 activate되지 않아 `fetch`가 가로채이지 않는다. `navigator.serviceWorker.ready`를 타임아웃과 함께 기다리되, 검증에 실패하면 **Cache Storage에 직접 `cache.put`** 한다. Workbox CacheFirst가 같은 `cacheName`을 읽으므로 송출 때 그대로 쓰인다.
3. **전체 200 응답을 캐시한다**: RangeRequestsPlugin은 캐시된 전체 응답을 잘라 206을 만든다. 부분 응답을 캐시에 넣으면 영상이 중간에 끊긴다. 프리다운로드는 `Range` 헤더 없이 요청한다.
4. **동일 출처다**: TECH_SPEC §5.4-3의 `fetch(url, { mode: 'cors' })`는 §5.4-1의 동일 출처 프록시 결정과 어긋난다. `mode`를 지정하지 않는다(문서는 `tasks_5.md`에서 정정).
5. **저장 실패를 삼키지 않는다**: `QuotaExceededError`와 네트워크 실패를 구분해 화면에 그대로 보여준다. M3-A의 `StorageWarningBanner` 원칙과 같다.
6. **`sync_meta`를 덮어쓰지 않는다**: 같은 레코드에 M3-B 동기화 필드(`serverUpdatedAt`·`dirty`·`lastSyncedAt`)가 들어 있다. 반드시 read-modify-write로 병합한다. 스토어는 v2에 이미 있으므로 **DB 버전을 올리지 않는다**.

---

## 2. 세부 작업 체크리스트

- [x] **Task 2.1: 세트 미디어 자산 수집 유틸리티 (TDD)**
  - **대상 파일**: `packages/shared/src/utils/offlineAssets.ts`
  - **선행 조건**: `tasks_1.md` Task 1.2
  - **구현 내용**:
    - `collectPresentationMediaAssets(presentation)` — `items[].deck.backgroundId`를 기존 `getBackgroundMediaUrl`·`getBackgroundPosterUrl`로 URL화
    - 곡별 표시용으로 `{ songIndex, songTitle, backgroundId, backgroundTitle, mediaUrl, posterUrl }`를 돌려준다
    - `collectUniqueMediaUrls(assets)` — **중복 제거**. 10개 루프를 여러 곡이 공유하는 것이 정상이므로 같은 영상을 두 번 받지 않는다
    - 배경이 없거나 알 수 없는 id인 곡은 URL 없이 표시만 남긴다(다운로드 대상에서 제외)
  - **DoD (통과 기준)**: `pnpm exec vitest run packages/shared/src/utils/offlineAssets.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.2: 오프라인 캐시 상태 저장소 (TDD)**
  - **대상 파일**: `apps/web/src/lib/storage/offlineStatusRepository.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - 선언만 되어 있고 읽고 쓰는 코드가 전혀 없던 `sync_meta` 스토어에 `isReady`·`cachedVideos`·`cachedAt`·`storagePersisted`를 기록한다
    - `saveOfflineStatus(presentationId, patch)` — 기존 레코드를 읽어 **병합**해 넣는다 (M3-B 필드 보존)
    - `loadOfflineStatus(presentationId)`, `clearOfflineStatus(presentationId)`
    - 실패는 `reportPersistenceError`로 올린다 (기존 `persistenceStatus.ts` 재사용)
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/lib/storage/offlineStatusRepository.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.3: Cache Storage 미디어 다운로더 (TDD)**
  - **대상 파일**: `apps/web/src/lib/offline/mediaCache.ts`
  - **선행 조건**: Task 2.2
  - **구현 내용**:
    - `cacheMediaUrls(urls, { onProgress, signal })` — URL 단위 순차 다운로드. 상태는 `pending | downloading | done | failed`
    - `content-length`를 합산해 총 캐시 용량을 보고한다 (PRD §6.3: 준비 화면에 세트 총 캐시 용량 표시)
    - 받은 응답을 `cache.put`으로 `MEDIA_CACHE_NAME`에 넣고, `cache.match`로 검증한다
    - `isMediaCached(urls)` — 이미 캐시된 URL 집합을 돌려줘 재방문 시 다시 받지 않게 한다
    - `QuotaExceededError`는 별도 실패 사유로 구분한다
    - jsdom에는 CacheStorage가 없으므로 `apps/web/src/test/setup.ts`에 최소 fake CacheStorage를 추가한다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/lib/offline/mediaCache.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.4: 영구 저장소 요청 래퍼 (TDD)**
  - **대상 파일**: `apps/web/src/lib/offline/storagePersistence.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `requestPersistentStorage()` — 이미 `persisted()`면 요청하지 않고 true. 미지원 브라우저는 `"unsupported"`로 구분
    - `estimateStorageUsage()` — `navigator.storage.estimate()`의 `usage`/`quota`를 돌려준다
    - 거부(`false`)는 예외가 아니라 상태다. 준비 화면이 경고를 띄운다 (PRD §6.1)
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/lib/offline/storagePersistence.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.5: 예배 준비 오케스트레이션 훅 (TDD)**
  - **대상 파일**: `apps/web/src/features/offline/useWorshipPrep.ts`
  - **선행 조건**: Task 2.1~2.4
  - **구현 내용**:
    - 자산 수집 → 이미 캐시된 것 확인 → 영구 저장소 요청 → 남은 URL 다운로드 → `sync_meta` 기록의 흐름을 한 훅으로 묶는다
    - 노출 상태: 곡별 자산 행, URL별 상태, 전체 진행률, 총 바이트, `isReady`, 영구 저장소 결과, 실패 사유
    - 언마운트 시 진행 중 다운로드를 `AbortController`로 취소한다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/features/offline/useWorshipPrep.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.6: 예배 준비 화면 라우트**
  - **대상 파일**: `apps/web/src/routes/WorshipReadyRoute.tsx`
  - **선행 조건**: Task 2.5
  - **구현 내용**:
    - 경로 `/present/:presentationId/ready` (PRD §5 화면 목록 기준)
    - 곡별 행: 번호·제목·배경 이름·상태 아이콘·용량
    - 상단: 전체 진행률 바, 총 캐시 용량, **'오프라인 송출 가능' 배지**(전부 완료일 때만)
    - 영구 저장소 거부 시 경고 문구
    - 하단 송출 버튼: 「단독 전체화면 송출」 / 「발표자 보기로 송출」 / 「지금 바로 송출(캐시 미완료)」
    - 전체화면 진입은 **버튼 클릭 제스처 안에서 동기적으로** 호출한다 (`fullscreen.ts`의 기존 주의사항)
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/routes/WorshipReadyRoute.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 2.7: 송출 진입점을 준비 화면으로 전환**
  - **대상 파일**: `apps/web/src/features/presentation/fullscreen.ts`, `apps/web/src/routes/PresentationsRoute.tsx`, `apps/web/src/routes/EditorRoute.tsx`, `apps/web/src/App.tsx`
  - **선행 조건**: Task 2.6
  - **구현 내용**:
    - `launchPreparation(navigate, presentationId)` 추가 — 대시보드 카드와 편집기 「슬라이드쇼 발표」가 이것을 쓴다
    - 기존 `launchPresentation`(즉시 전체화면)은 준비 화면의 버튼용으로 남긴다
    - `App.tsx`에 `/present/:presentationId/ready` 라우트 등록
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/routes`가 100% 통과(Green)한다.

- [x] **Task 2.8: 세트 글꼴 사전 로드 (문서 원안에 없던 추가 태스크)**
  - **대상 파일**: `apps/web/src/lib/offline/fontWarmup.ts`
  - **선행 조건**: Task 2.5
  - **구현 내용**:
    - `tasks_1.md`에서 폰트를 프리캐시 대상에서 뺐다(전체 33MB). 그래서 세트가 쓰는 글꼴이 오프라인에서 자동으로 보장되지 않는다
    - 준비 단계에서 세트 가사에 실제로 쓰인 글자를 모아 `document.fonts.load()`를 부른다. 그러면 필요한 유니코드 서브셋만 요청되어 `worship-fonts-cache`에 들어간다
    - 실패는 무시한다. 글꼴 워밍 실패로 준비 자체가 막히면 안 된다
  - **DoD (통과 기준)**: `pnpm exec vitest run packages/shared/src/utils/offlineAssets.test.ts`의 `collectPresentationFonts` 케이스가 통과한다.

---

## 3. 검증 명령어

```bash
pnpm exec vitest run packages/shared/src/utils/offlineAssets.test.ts
pnpm exec vitest run apps/web/src/lib/offline apps/web/src/lib/storage apps/web/src/features/offline apps/web/src/routes
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_3.md`(M4-3)에서 송출 위치 계산을 순수 함수로 뽑고 BroadcastChannel 동기화 계층을 붙인다.
