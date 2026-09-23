# Goal: [M5-3] 공개·검색·가져오기·신고 API (packages/db, worker)

> **마일스톤**: M5 (공유·가사 라이브러리)
> **태스크 번호**: `tasks_3.md`
> **선행 조건**: `docs/tasks/m5/tasks_2.md` 완료 (보관함 덱이 서버에 있다)
> **목표**: 공유 라이브러리(PRD 4.7)와 가사 라이브러리(PRD 4.8)의 서버 경로를 모두 연다 — 공개 전환, 통합 검색, 공개 덱 상세, 가져오기(fork), 곡 식별 후보, 대표 가사 가져오기, 신고
> **완료 기준 (DoD)**: 실제 라우트를 마운트한 worker 테스트에서 A가 공개한 덱을 B가 검색(미리보기만)·상세 조회·가져오기 하면 B의 보관함에 비공개 포크가 생기고 A 덱의 가져간 횟수가 1 오르며, 비공개·세트 복제본·게시 중단 덱은 어떤 경로로도 보이지 않는다

> **구현 현황 (2026-09-23)**
>
> - Task 3.1~3.9 완료. 전체 **803개 / 98파일 Green**.
> - 포크본의 원작자 이름은 **가져온 덱을 공개한 사람**이다. 포크본을 다시 공개하고 그것을 또 가져가도 원작자 이름을 거슬러 올라가지 않는다. 대신 공개 카드에 `forkedFromAuthorName`을 함께 내보내 '이 덱도 누군가의 것을 가져왔다'는 사실은 남는다.
> - 공개 전환 실패 사유(404·400·409)를 서버가 한국어 문장으로 준다. 클라이언트는 `ServerRejectedError.message`를 그대로 보여 준다(M5-5).
> - 같은 사용자가 공개 덱과 대표 가사를 여러 번 가져와도 보관함에는 한 곡만 생긴다(멱등). 이미 가진 곡이면 `alreadyOwned: true`.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **모든 변경은 세션 사용자 범위다**: 공개 전환은 소유자만, 가져오기·신고는 로그인 사용자만. 대상 id는 경로에서, 사용자는 세션에서 온다 (CLAUDE.md §6.2).
2. **공개 조회는 헬퍼의 `publicDeckCondition()`만 거친다**: 라우트가 조건을 조립하지 않는다.
3. **공개 검색은 미리보기만 준다**: `GET /api/catalog/search`는 로그인 없이 열리므로 로그인 여부와 무관하게 첫 슬라이드 / 첫 2줄만 담는다. 전문은 로그인 후 `GET /api/catalog/decks/:id`로만 준다 (TECH_SPEC §8.1).
4. **공개 동의는 `true` 리터럴**: 스키마가 `acceptedCopyrightNotice: z.literal(true)`를 강제한다 (M5-1).
5. **가져오기는 멱등이다**: 같은 공개 덱을 두 번 가져오면 새 덱을 만들지 않고 이전 포크를 돌려준다. 가져간 횟수도 한 번만 오른다. 자기 덱은 가져오지 않는다.
6. **포크본·대표 가사로 만든 덱은 루트 버전이 아니다**: `origin='fork' | 'catalog'`, `contributeToCatalog=false`로 만든다 (PRD 4.8).
7. **모든 입력은 `packages/shared` 스키마로 검증한다**: `zValidator`.

---

## 2. 세부 작업 체크리스트

- [x] **Task 3.1: 미리보기 헬퍼 (TDD)**
  - **대상 파일**: `packages/shared/src/utils/previews.ts`, `previews.test.ts`
  - **선행 조건**: 없음
  - **구현 내용**: `firstSlidePreview(slides)` — `order`가 가장 앞선 슬라이드의 줄. `twoLinesPreview(text)` — 빈 줄을 건너뛴 첫 2줄
  - **DoD (통과 기준)**: `pnpm vitest run packages/shared/src/utils/previews.test.ts`가 100% 통과(Green)한다.

- [x] **Task 3.2: 공유 쿼리 헬퍼 (TDD)**
  - **대상 파일**: `packages/db/src/queries/sharing.ts`, `sharing.test.ts`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - `toPublicDeckSummary`·`toPublicDeckDetail`·`toCatalogLyricSummary` — 공개 응답 모양으로 자른다 (`userId` 없음)
    - `setDeckVisibility(db, userId, deckId, visibility)` → `ok | not_found | not_library | taken_down | empty`. 공개하면 `published_at`을 기록한다
    - `getPublicDeckDetail(db, deckId)` — 작성자 이름 포함
    - `forkPublicDeck(db, userId, sourceId)` — 멱등, 자기 덱은 `alreadyOwned`. 포크 insert와 `fork_count + 1`을 `batch`로 묶는다. 포크는 비공개·`origin='fork'`·기여 끔·작성자명 스냅샷
    - `importCatalogLyrics(db, userId, catalogId)` — 대표 가사를 `splitLyricsIntoSlides`로 나눠 보관함 곡을 만든다. `origin='catalog'`, 멱등
    - `getCatalogCandidates(db, title, artist)` — 제목 정규화 키가 같은 곡, `exact` 표시, 최대 5건
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/sharing.test.ts`가 100% 통과(Green)한다.

- [x] **Task 3.3: 신고 쿼리 헬퍼 (TDD)**
  - **대상 파일**: `packages/db/src/queries/reports.ts`, `reports.test.ts`
  - **선행 조건**: Task 3.2
  - **구현 내용**: `createReport(db, userId, input)` → `ok | not_found | duplicate`. 덱 신고는 공개 덱만(비공개 덱의 존재를 확인하는 창구가 되지 않게), 카탈로그 신고는 등록자가 있는 곡만. 같은 사용자가 같은 대상에 대기 중 신고를 또 내면 `duplicate`
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/reports.test.ts`가 100% 통과(Green)한다.

- [x] **Task 3.4: 덱 공개 전환·가져오기 라우트**
  - **대상 파일**: `apps/web/worker/routes/decks.ts`
  - **선행 조건**: Task 3.2
  - **구현 내용**: `PATCH /api/decks/:id/visibility`(404·400·409), `POST /api/decks/:id/fork`(404)
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 3.5: 카탈로그 라우트**
  - **대상 파일**: `apps/web/worker/routes/catalog.ts`
  - **선행 조건**: Task 3.2
  - **구현 내용**:
    - `GET /api/catalog/search` — 공개, `cache-control: public, max-age=30`
    - `GET /api/catalog/decks/:id` — 로그인 필요, 전문
    - `GET /api/catalog/candidates?title=&artist=` — 로그인 필요
    - `POST /api/catalog/lyrics/:id/import` — 로그인 필요
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 3.6: 신고 라우트**
  - **대상 파일**: `apps/web/worker/routes/reports.ts`
  - **선행 조건**: Task 3.3
  - **구현 내용**: `POST /api/reports` → 201 `{id}` / 404 / 409
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 3.7: 앱에 마운트**
  - **대상 파일**: `apps/web/worker/index.ts`
  - **선행 조건**: Task 3.4~3.6
  - **구현 내용**: `/api/catalog`, `/api/reports`를 `createApp` 체인에 넣는다 (체인 밖에 두면 `AppType`에서 빠진다)
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/worker/index.test.ts`가 100% 통과(Green)한다.

- [x] **Task 3.8: 공유 경로 통합 테스트**
  - **대상 파일**: `apps/web/worker/routes/sharing.test.ts`
  - **선행 조건**: Task 3.7
  - **구현 내용**: `createApp({ readSession })`으로 실제 라우트를 마운트한다. 누출 없음(비공개·세트 복제본·게시 중단), 검색은 미리보기만, 상세는 비로그인 401, 동의 없는 공개 400, 남의 덱 공개 전환 404, 가져간 횟수 1회만, 포크본 비공개·원작자 표시, 대표 가사 가져오기, 곡 식별 후보, 신고 중복 409
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/worker/routes/sharing.test.ts`가 100% 통과(Green)한다.

- [x] **Task 3.9: 전체 검증**
  - **대상 파일**: 없음
  - **선행 조건**: Task 3.1~3.8
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 모두 통과한다.

---

## 3. 검증 명령어

```bash
pnpm vitest run packages/shared/src/utils/previews.test.ts packages/db/src/queries/ apps/web/worker/
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_4.md` — 같은 곡에 루트 버전이 2개 이상 쌓이면 Workers AI로 대표 가사를 만들고 검증한다.
