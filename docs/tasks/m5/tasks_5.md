# Goal: [M5-5] 프론트엔드 공유 UI (apps/web)

> **2026-09-23 범위 변경**: LLM 가사 정규화와 가사 라이브러리(카탈로그·가사 기여·대표 가사·곡 식별)는 MVP에서 제거됐다 (`packages/db/drizzle/0005_remove_catalog.sql`). 공유 라이브러리는 같은 곡을 여러 사람이 따로 공개하는 게시판(가져간 횟수순)만 남는다. 이 문서의 해당 부분은 이력으로 남긴다.

> **마일스톤**: M5 (공유·가사 라이브러리)
> **태스크 번호**: `tasks_5.md`
> **선행 조건**: `docs/tasks/m5/tasks_3.md`·`tasks_4.md` 완료 (공유 API, 정규화)
> **목표**: 샘플 공유 곡을 걷어내고 곡 추가 모달을 실제 공유 라이브러리·가사 라이브러리에 붙인다. 편집기 속성 패널에 '공유'를 두어 곡을 공개·비공개로 돌리고, 원작 표시·교정 제안·신고를 연다
> **완료 기준 (DoD)**: 곡 추가 모달이 서버 검색 결과를 보여 주고, 공유 곡을 '가져와서 프레젠테이션에 추가'하면 내 보관함에 포크가 생긴 뒤 세트에 담긴다. 편집기 '공유'에서 저작권 안내에 동의해야만 공개된다. 송출 화면은 여전히 네트워크 요청 0건이다

> **구현 현황 (2026-09-23)**
>
> - Task 5.1~5.13 완료. 전체 **861개 / 103파일 Green**, `pnpm --filter web build` 통과.
> - **설계에서 바뀐 것 — 곡 식별 후보는 훅이 아니라 등록 시점의 1회 조회다.** '이 곡이 맞나요?'는 저장 버튼을 누를 때 한 번만 물으면 되므로 `useCatalogCandidates` 대신 `fetchCatalogCandidates`를 직접 부른다. 오프라인이거나 조회가 실패하면 묻지 않고 저장한다 — 서버가 정규화 키로 같은 곡을 찾아 묶는다.
> - **설계에서 바뀐 것 — `PublishDialog`·`ReportDialog`의 테스트 파일을 따로 두지 않았다.** 두 대화상자는 `SongSharePanel.test.tsx`와 `SongPickerModal.test.tsx`가 실제 흐름(동의 전 버튼 비활성, 신고 본문)으로 덮는다.
> - **PRD 4.8과의 편차 — 포크본의 교정 제안은 자동 접수가 아니라 수동이다.** '원본에 교정 제안' 버튼이 사유 `correction`으로 신고 대화상자를 연다. 포크본을 고칠 때마다 제안을 자동으로 만들면 개인 취향의 편집(글자 크기에 맞춘 줄바꿈 등)까지 운영자 대기열에 쌓인다.
> - `COMMUNITY_SONGS` 샘플은 지웠다. 배경 라이브러리 화면의 '내가 등록한 배경' 샘플만 `mockCustomBackgrounds.ts`로 남았다(커스텀 배경 업로드는 아직 없다, PRD 4.3).
> - Zero-Fetch 가드: ESLint가 송출 라우트·`features/presentation/**`·`components/stage/**`에서 `@tanstack/react-query`와 `lib/api/*` import를 막는다. `zeroFetch.test.tsx`는 QueryClient 공급자 안에서도 송출 화면이 fetch 0건임을 확인한다.
> - **실검증은 남아 있다.** 브라우저에서 두 계정으로 공개 → 검색 → 가져오기 → 송출을 확인하는 것은 `tasks_6.md` Task 6.4다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **서버 캐시는 TanStack Query, 그 외 상태는 기존 스토어**: 검색·공개 덱 상세·포크·가져오기·공개 전환·신고만 Query/Mutation으로 다룬다. 프레젠테이션·보관함 곡의 원천은 여전히 IndexedDB다 (CLAUDE.md §7.3, TECH_SPEC §5.5).
2. **송출 화면은 서버 캐시 계층을 import하지 않는다**: ESLint 규칙으로 막는다. flat config는 규칙 옵션을 파일별로 덮어쓰므로 `@repo/db` 제한도 같은 블록에 반복한다.
3. **모든 호출은 `hc<AppType>`**: 응답은 `packages/shared` 스키마로 다시 parse한다 (CLAUDE.md §6.1).
4. **오프라인에서도 곡 추가는 된다**: 서버에 닿지 못하면 '오프라인 — 내 곡만 표시합니다'를 띄우고 내 보관함만 보여 준다.
5. **공개 단위는 보관함 원본**: 편집기 '공유'는 세트 곡 내용을 보관함 원본에 반영한 뒤 그 원본을 공개한다. 세트 복제본은 언제나 비공개다 (M5-1).
6. **공개는 동의 뒤에만**: 저작권 안내 체크 없이는 버튼이 눌리지 않고, 서버도 `true` 리터럴을 요구한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 5.1: `@tanstack/react-query` 설치**
  - **대상 파일**: `apps/web/package.json`
  - **선행 조건**: 없음
  - **구현 내용**: v5
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 5.2: QueryClient와 공급자**
  - **대상 파일**: `apps/web/src/lib/api/queryClient.ts`, `apps/web/src/App.tsx`
  - **선행 조건**: Task 5.1
  - **구현 내용**: `networkMode: 'online'`, 포커스 재조회 끔, 재시도 1회. 공급자는 로그인 뒤 분기에만 둔다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/App.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 5.3: 송출 화면 import 가드**
  - **대상 파일**: `packages/config/eslint/index.js`, `apps/web/src/routes/zeroFetch.test.tsx`
  - **선행 조건**: Task 5.2
  - **구현 내용**: 송출 라우트·`features/presentation/**`·`components/stage/**`에서 `@tanstack/react-query`·`lib/api/*`·`@repo/db` import 금지. Zero-Fetch 테스트를 공급자 안에서도 돌린다
  - **DoD (통과 기준)**: `pnpm lint && pnpm vitest run apps/web/src/routes/zeroFetch.test.tsx`가 통과한다.

- [x] **Task 5.4: 공유 API 함수와 훅**
  - **대상 파일**: `apps/web/src/lib/api/request.ts`, `catalogApi.ts`, `catalogQueries.ts`
  - **선행 조건**: Task 5.2
  - **구현 내용**:
    - `callApi` — 동기화 상태 배지를 건드리지 않는 요청 래퍼. `OfflineError`·`SessionExpiredError`·`ServerRejectedError(서버 문장)`
    - `searchCatalog`, `fetchPublicDeck`, `fetchCatalogCandidates`, `forkPublicDeck`, `importCatalogLyrics`, `updateDeckVisibility`, `submitReport`
    - `useCatalogSearch`(250ms 디바운스, 이전 결과 유지), `usePublicDeck`, `useForkDeck`·`useImportCatalogLyrics`(성공 시 보관함에 넣기), `useSetDeckVisibility`, `useSubmitReport`
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 5.5: 세트 복제 규칙과 보관함 연결**
  - **대상 파일**: `apps/web/src/features/presentation/presentationStore.ts`, `presentationStore.test.ts`
  - **선행 조건**: 없음
  - **구현 내용**: 복제본의 `forkedFrom` = 복제해 온 보관함 덱, 공개·가져간 횟수·기여 끔. `linkSongToLibraryDeck(songIndex, deckId)`
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/presentation/presentationStore.test.ts`가 100% 통과(Green)한다.

- [x] **Task 5.6: 샘플 공유 곡 제거**
  - **대상 파일**: `apps/web/src/features/editor/songLibraryStore.ts`, `features/library/mockCustomBackgrounds.ts`
  - **선행 조건**: Task 5.4
  - **구현 내용**: `COMMUNITY_SONGS`와 `useAvailableSongs`를 지우고 `useUserSongs`·`useLibraryDeck`로 바꾼다
  - **DoD (통과 기준)**: `grep -rn "COMMUNITY_SONGS" apps/web/src`가 0건이다.

- [x] **Task 5.7: 곡 추가 모달을 서버 검색으로**
  - **대상 파일**: `apps/web/src/features/editor/SongPickerModal.tsx`, `songPicker/{CreateSongForm,CatalogCandidateChooser,SongPickerPreview,LyricsViewer,CatalogStatusBadge}.tsx`, `hooks/useIsOnline.ts`, `SongPickerModal.test.tsx`, `test/fakeApi.ts`, `test/queryClientFixture.tsx`
  - **선행 조건**: Task 5.6
  - **구현 내용**:
    - 필터: 전체 / 내 곡 / 공유 곡 / 가사 라이브러리
    - 공유 곡: 작성자·가져간 횟수, 로그인 사용자에게 전문 미리보기(PRD 4.7), '가져와서 프레젠테이션에 추가' = fork → 보관함 → 세트. 이미 가져온 곡은 '보관함에 있음'으로 표시하고 사본을 쓴다. 내가 공개한 곡은 공유 목록에서 뺀다
    - 가사 라이브러리: '1명 등록' / '정규화됨 · N명 등록' / '검수됨 · N명 등록' 배지, 첫 2줄만, 대표 가사 가져오기
    - 직접 등록: '가사 라이브러리에 기여' 체크박스, '이 곡이 맞나요?' 후보 선택(제목·아티스트가 같은 곡이 하나뿐이면 묻지 않는다)
    - 신고 버튼, 오프라인 안내
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/editor/SongPickerModal.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 5.8: 공개 로직 (TDD)**
  - **대상 파일**: `apps/web/src/features/sharing/publishSong.ts`, `publishSong.test.ts`
  - **선행 조건**: Task 5.5
  - **구현 내용**: `resolveLibraryMaster`, `buildPublishedDeck`(슬라이드에서 `lyricsRaw` 재생성), `hasUnpublishedChanges`, `canContributeFromSong`, `publishSong`(원본 즉시 push → 공개 요청), `updatePublishedSong`, `unpublishSong`. 원본 업로드가 실패하면 공개 요청을 보내지 않는다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/sharing/publishSong.test.ts`가 100% 통과(Green)한다.

- [x] **Task 5.9: 공개 동의 대화상자**
  - **대상 파일**: `apps/web/src/features/sharing/PublishDialog.tsx`
  - **선행 조건**: Task 5.8
  - **구현 내용**: 공개 범위·저작권(CCLI 범위 내 사용 책임, 권리자 요청 시 게시 중단)·비공개 전환 후에도 사본이 남는다는 안내, 필수 동의 체크, 루트 곡이면 '가사 라이브러리에도 기여'
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/sharing/SongSharePanel.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 5.10: 신고 대화상자**
  - **대상 파일**: `apps/web/src/features/sharing/ReportDialog.tsx`
  - **선행 조건**: Task 5.4
  - **구현 내용**: 사유(가사 오류·교정 제안·부적절·저작권), 상세 500자
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/editor/SongPickerModal.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 5.11: 편집기 '공유' 패널**
  - **대상 파일**: `apps/web/src/features/sharing/SongSharePanel.tsx`, `SongSharePanel.test.tsx`
  - **선행 조건**: Task 5.9, 5.10
  - **구현 내용**: 비공개 / 공개 중 · N회 가져감 / 게시 중단됨, '원작: X'와 '원본에 교정 제안', 공개·공개본 업데이트·비공개 전환. 오프라인이면 버튼을 막는다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/features/sharing/SongSharePanel.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 5.12: 편집기에 연결**
  - **대상 파일**: `apps/web/src/features/editor/SongPropertyPanel.tsx`(`footer` 슬롯), `apps/web/src/routes/EditorRoute.tsx`, `EditorRoute.test.tsx`
  - **선행 조건**: Task 5.11
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/src/routes/EditorRoute.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 5.13: 전체 검증**
  - **대상 파일**: 없음
  - **선행 조건**: Task 5.1~5.12
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build`가 모두 통과한다.

---

## 3. 검증 명령어

```bash
pnpm vitest run apps/web/src/features/editor apps/web/src/features/sharing apps/web/src/routes
grep -rn "COMMUNITY_SONGS" apps/web/src   # 0건
pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build
```

---

## 4. 이 태스크 이후

`tasks_6.md` — 운영 런북(신고·게시 중단·잠금), 2계정 E2E, Chrome 실검증, 문서 정합화.
