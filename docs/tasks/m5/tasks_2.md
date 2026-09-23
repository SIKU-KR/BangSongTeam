# Goal: [M5-2] 보관함 덱 서버 동기화·서버측 가사 기여 (worker, apps/web)

> **마일스톤**: M5 (공유·가사 라이브러리)
> **태스크 번호**: `tasks_2.md`
> **선행 조건**: `docs/tasks/m5/tasks_1.md` 완료 (서버 소유 공유 필드)
> **목표**: 보관함 곡을 실제로 D1에 올리고 받아 온다. 가사 기여는 `?contribute` 쿼리 대신 덱의 `contributeToCatalog` 플래그와 서버가 정한 `origin`으로 서버가 판정한다
> **완료 기준 (DoD)**: 곡 추가 모달에서 '가사 라이브러리에 기여'를 켠 채 곡을 등록하면, 로컬 IndexedDB를 지우고 다시 접속해도 그 곡이 서버에서 복원되고 `lyrics_versions`에 루트 버전이 1건 생긴다

> **구현 현황 (2026-09-23)**
>
> - Task 2.1~2.9 완료. 전체 **763개 / 94파일 Green**.
> - **원안보다 넓힌 것 — 제목이 바뀐 덱의 표 회수.** 덱 제목을 고쳐 다른 곡이 되면 옛 곡에 그 덱의 버전이 남아 다수결에 계속 참여했다. `contributeLyrics`가 옛 곡의 표를 지우고 버전 수를 다시 센다.
> - **원안보다 넓힌 것 — 빈 카탈로그 숨김.** D1에는 트랜잭션이 없어 첫 기여가 버전 insert에서 실패하면 등록자 0명인 카탈로그가 남는다. `searchCatalog`가 `version_count > 0`만 보여 준다.
> - `presentationSync.send`가 4xx·5xx를 `ServerRejectedError(status, 서버 문장)`로 던진다. 보관함 삭제의 404를 성공으로 보고, 공개 전환(M5-5)이 409 사유를 사용자에게 보여 주기 위해서다.
> - 서버 응답 덱을 받는 쪽(`setServerDeckListener`)은 `runBootSync`가 등록한다. 부팅 동기화를 건너뛰는 송출 창에서는 자동 push도 꺼진 채로 남는다.
> - **실검증은 남아 있다.** '로컬 IndexedDB 삭제 후 복원'은 `tasks_6.md`의 2계정 Chrome 검증에서 함께 확인한다.

> **배경 (2026-09-23 조사)**: M3-B에서 `pushDeck`/`pullDecks`를 만들었지만 호출부가 없었다. 부팅 동기화는 프레젠테이션만 받고, `songLibraryStore`는 IndexedDB에만 쓴다. `?contribute=true`를 보내는 클라이언트도 없어 가사 라이브러리는 한 번도 채워진 적이 없다. 공유(M5-3)는 보관함 덱이 서버에 있어야 성립하므로 이 파일이 선행한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **로컬 IndexedDB가 1차 원천이다**: 서버 push는 로컬 저장 뒤에 따로 돈다. 네트워크가 로컬 저장을 막지 않는다 (TECH_SPEC §5.5).
2. **서버 소유 필드는 병합에서 항상 서버 값**: `visibility`·`forkCount`·`origin`·`forkedFrom`·`forkedFromAuthorName`·`publishedAt`·`takedownAt`은 `updatedAt`과 무관하게 서버 쪽을 쓴다. 내용(가사·슬라이드·스타일)만 LWW로 고른다.
3. **루트 버전 판정은 서버가 한다**: `scope='library' AND origin='user' AND contributeToCatalog`. 클라이언트가 보낸 `origin`은 `upsertDeck`이 무시한다 (M5-1).
4. **기여 실패가 곡 저장을 되돌리지 않는다**: M3-B와 같다. 카탈로그는 부가 기능이다.
5. **송출 화면에서는 부팅 동기화를 돌리지 않는다**: 발표자 보기가 연 청중 창은 새 문서라 부팅 경로를 다시 탄다. `/present/:id/(fullscreen|control)`에서는 동기화를 켜지 않아 Zero-Fetch(M4-5)를 지킨다. 예배 준비(`/ready`)는 온라인 단계이므로 그대로 둔다.
6. **테스트는 실제 라우트를 마운트한다**: 지금 worker 테스트는 핸들러를 복제해 쓰므로 라우트가 바뀌어도 테스트가 모른다. 라우트를 팩토리로 바꾸고 `createApp({ readSession })`으로 실제 코드를 검증한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 2.1: `contributeLyrics` 확장 (TDD)**
  - **대상 파일**: `packages/db/src/queries/lyrics.ts`, `lyrics.test.ts`
  - **선행 조건**: `tasks_1.md` 완료
  - **구현 내용**:
    - `preferredCatalogId` — '이 곡이 맞나요?'에서 고른 카탈로그. 존재하고 제목 정규화 키가 같을 때만 쓴다 (다른 곡으로 투표를 옮기는 것을 막는다)
    - 카탈로그 생성은 `onConflictDoNothing`(unique 키) 후 다시 읽는다 — 동시 첫 기여 경합
    - 반환값에 `changed`(버전이 새로 생겼거나 가사가 바뀜)를 더한다. 정규화 트리거(M5-4)의 조건이다
    - 등록 1명(`status='single'`, 버전 1)인 곡은 그 사람이 가사를 고치면 대표 가사도 따라 바뀐다
    - 같은 덱이 제목을 바꿔 다른 곡으로 옮겨 가면, 옛 곡에 남은 그 덱의 버전을 지우고 옛 곡의 버전 수를 다시 센다
    - `decks.catalog_id`를 되써 준다 (userId·deckId 범위)
    - `shouldContribute(deck)` — 루트 버전 판정 함수
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/lyrics.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.2: 라우트 팩토리와 `createApp`**
  - **대상 파일**: `apps/web/worker/routes/decks.ts`, `routes/presentations.ts`, `worker/index.ts`, `worker/types.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `AppDeps { readSession?: SessionReader }`. `createDecksRoute(deps)`, `createPresentationsRoute(deps)`, `createApp(deps = {})`
    - `export type AppType = ReturnType<typeof createApp>` — 체인 추론을 그대로 유지한다
    - `PUT /api/decks/:id`: 저장 → `shouldContribute(saved)`면 기여 → 기여가 `catalogId`를 바꿨으면 덱을 다시 읽어 응답한다. `?contribute`는 없앤다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/worker/index.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.3: worker 테스트를 실제 라우트로**
  - **대상 파일**: `apps/web/worker/routes/lyrics.test.ts`, `routes/sync.test.ts`
  - **선행 조건**: Task 2.2
  - **구현 내용**: 복제한 핸들러를 걷어내고 `createApp({ readSession: fake })`를 마운트한다. 기여 케이스: 플래그 켬/끔, 포크본(`origin='fork'`)은 기여 안 함, 응답 덱에 `catalogId`가 붙음, 기여 실패가 저장을 되돌리지 않음
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/worker/`가 100% 통과(Green)한다.

- [x] **Task 2.4: 보관함 병합 (TDD)**
  - **대상 파일**: `apps/web/src/lib/sync/mergeLibraryDecks.ts`, `mergeLibraryDecks.test.ts`
  - **선행 조건**: 없음
  - **구현 내용**: 덱 단위 LWW. 서버 소유 필드는 항상 서버 값, `catalogId`는 서버 값이 있으면 서버. 서버에 없거나 로컬이 더 최신이면 `needsPush`
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/lib/sync/mergeLibraryDecks.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.5: 보관함 push 큐 (TDD)**
  - **대상 파일**: `apps/web/src/lib/sync/deckSync.ts`, `deckSync.test.ts`, `presentationSync.ts`
  - **선행 조건**: Task 2.4
  - **구현 내용**:
    - `scheduleDeckPush(deck)`, `scheduleDeckDelete(id)`, `pushDeckNow(deck)`, `flushDeckSync()`, `setDeckSyncEnabled()`
    - 오프라인이면 다시 큐에 넣는다. 서버 응답 덱은 `onServerDeck` 콜백으로 스토어에 반영한다 (서버 소유 필드·`catalogId`)
    - `pushDeck`이 서버가 확정한 덱을 돌려주고, `deleteDeckRemote`를 더한다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/lib/sync/deckSync.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.6: 곡 보관함 스토어 서버 연결**
  - **대상 파일**: `apps/web/src/features/editor/songLibraryStore.ts`, `songLibraryStore.test.ts`
  - **선행 조건**: Task 2.5
  - **구현 내용**:
    - `saveSongToLibrary`가 `contributeToCatalog`(신규 곡 기본 true)·`catalogId`를 받고 push를 예약한다
    - `upsertLibraryDeck(deck, { push })`, `applyServerLibraryDecks(decks)`, `applyServerDeckFields(deck)`, `getLibraryDeck(id)`
    - `deleteUserSong`이 서버 삭제를 예약한다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/editor/songLibraryStore.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.7: 부팅 동기화에 보관함 추가 + 송출 화면 가드**
  - **대상 파일**: `apps/web/src/lib/sync/bootSync.ts`, `bootSync.test.ts`, `lib/sync/index.ts`, `App.tsx`
  - **선행 조건**: Task 2.6
  - **구현 내용**:
    - 프레젠테이션 병합 뒤 `pullDecks` → `mergeLibraryDecks` → 적용·로컬 저장 → `needsPush` 업로드
    - `shouldRunBootSync(pathname)` — `/present/:id/fullscreen`·`/present/:id/control`이면 false. `App.tsx`가 이 가드를 통과할 때만 `runBootSync`를 부른다
    - `pagehide` 플러시에 `flushDeckSync`를 더한다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/lib/sync/`가 100% 통과(Green)한다.

- [x] **Task 2.8: '가사 라이브러리에 기여' 체크박스**
  - **대상 파일**: `apps/web/src/features/editor/SongPickerModal.tsx`, `SongPickerModal.test.tsx`
  - **선행 조건**: Task 2.6
  - **구현 내용**: 직접 등록 폼에 체크박스(기본 켜짐, PRD 4.8)를 넣고 값을 `saveSongToLibrary`에 넘긴다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/editor/SongPickerModal.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 2.9: 전체 검증**
  - **대상 파일**: 없음
  - **선행 조건**: Task 2.1~2.8
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 모두 통과한다.

---

## 3. 검증 명령어

```bash
pnpm vitest run packages/db/src/queries/lyrics.test.ts apps/web/worker/ apps/web/src/lib/sync/ apps/web/src/features/editor/
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_3.md` — 공개 전환·검색·가져오기·후보 조회·신고 API.
