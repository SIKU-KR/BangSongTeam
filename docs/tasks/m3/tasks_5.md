# Goal: [M3B-4] 서버 동기화 계층 (로컬 우선 + LWW 병합)

> **마일스톤**: M3-B (계정·서버 저장)
> **태스크 번호**: `tasks_5.md`
> **선행 조건**: `docs/tasks/m3/tasks_4.md` 완료 (RPC 클라이언트 + 로그인 게이트)
> **목표**: 편집한 세트를 D1로 밀어 올리고 부팅 시 받아 내려, 다른 PC에서 로그인해도 같은 세트가 보이게 한다
> **완료 기준 (DoD)**: A 브라우저에서 만든 세트가 B 브라우저(같은 계정)에서 그대로 열리고, 네트워크를 끊어도 편집·송출이 계속된다

> **구현 현황 (2026-09-22)**
>
> - Task 4.1~4.7 완료. 전체 **477개 / 64파일 Green**.
> - 2-브라우저 실제 왕복은 `tasks_6.md`에서 검증한다 (실제 OAuth 자격증명 필요).
> - `vi.spyOn`으로 ES 모듈 함수 export를 바꿀 수 없어 스케줄러의 전송 함수를 주입식으로 뒀다 (세션 스토어와 같은 방식).

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **로컬이 먼저다**: 모든 편집은 지금처럼 IndexedDB에 먼저 쓰고, 서버 반영은 그 뒤에 덧붙인다. **느린 네트워크가 로컬 저장을 막으면 안 된다** — 큐와 in-flight 체인을 IndexedDB 쪽과 분리한다.
2. **오프라인은 실패가 아니다**: 네트워크에 닿지 못하는 것은 정상 동작이다. 빨간 배너를 띄우지 않는다. 예배 중에 경고가 뜨면 그게 사고다.
3. **송출 경로는 네트워크를 쓰지 않는다**: `/present/*`에서는 동기화가 돌지 않는다 (TECH_SPEC Zero-Fetch 불변식).
4. **문서 단위 LWW**: 서버와 로컬이 다르면 `updatedAt`이 늦은 쪽을 택한다. 필드 단위 병합은 하지 않는다 — 곡 순서와 스타일이 섞이면 사용자가 이해할 수 없는 결과가 나온다.
5. **비활성 문서도 올라가야 한다**: 기존 IndexedDB 스케줄러는 `state.activeId`만 큐에 넣는다. 동기화 큐가 같은 제약을 물려받으면 비활성 문서 변경이 영영 안 올라간다.
6. **삭제는 이번 범위가 아니다**: tombstone이 없으면 '서버에 없음'과 '아직 안 올림'을 구분할 수 없다. 이번에는 '서버에 없으면 로컬 유지'로 두고 명시적 삭제 UI는 범위 밖으로 남긴다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 4.1: 동기화 상태 스토어 (TDD)**
  - **대상 파일**: `src/client/lib/sync/syncStatus.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `idle` / `syncing` / `synced` / `offline` / `error` 상태와 구독 훅
    - 저장 실패(`persistenceStatus`)와 슬롯을 분리한다. 로컬 저장 실패는 경고지만 오프라인은 정상이다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/sync/syncStatus.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.2: 서버 통신 모듈 (TDD)**
  - **대상 파일**: `src/client/lib/sync/presentationSync.ts`
  - **선행 조건**: Task 4.1
  - **구현 내용**:
    - `pushPresentation(doc)` / `pullPresentations()` / `pushDeck(deck)` / `pullDecks()`
    - 401은 세션 만료로 다루고, 네트워크 실패는 `offline`로 구분한다
    - 덱이 비어 있는 항목은 올리지 않는다 (`PresentationDocumentSchema`가 거절한다)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/sync/presentationSync.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.3: 디바운스 push 스케줄러 (TDD)**
  - **대상 파일**: `src/client/lib/sync/syncScheduler.ts`
  - **선행 조건**: Task 4.2
  - **구현 내용**:
    - 문서 단위 디바운스(≈2s). IndexedDB(300ms)보다 길게 잡아 네트워크 왕복을 줄인다
    - 큐와 in-flight 체인을 로컬 저장과 완전히 분리한다
    - `flushPendingSync()` — 창이 숨겨질 때 앞당긴다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/sync/syncScheduler.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: 큐(`Map`)와 in-flight 체인을 IndexedDB 쪽과 완전히 분리했다. 같은 문서를 연달아 고치면 마지막 값 하나만 올라간다.

- [x] **Task 4.4: LWW 병합 (TDD)**
  - **대상 파일**: `src/client/lib/sync/mergeDocuments.ts`
  - **선행 조건**: Task 4.2
  - **구현 내용**:
    - 문서 id 기준으로 로컬·서버를 합치고, 양쪽에 있으면 `updatedAt`이 늦은 쪽을 택한다
    - 로컬에만 있는 문서는 유지하고 push 대상으로 표시한다 (첫 로그인 업로드 경로)
    - 서버에만 있는 문서는 그대로 받는다 (다른 PC에서 만든 세트)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/sync/mergeDocuments.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.5: 스토어 연동 및 부팅 동기화**
  - **대상 파일**: `src/client/features/presentation/presentationStore.ts`, `src/client/App.tsx`
  - **선행 조건**: Task 4.3, Task 4.4
  - **구현 내용**:
    - `emitChange()`에 `scheduleDocumentPush()`를 `schedulePersist()` 옆에 붙인다 (뮤테이터 30개를 한 줄로 덮는다)
    - `applyServerDocuments(docs)` — 병합 결과를 스토어에 반영한다
    - 부팅 시: 로컬 하이드레이션 → 렌더 → **백그라운드로** pull·병합. 서버를 기다리느라 첫 화면이 늦어지면 안 된다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/presentation`이 100% 통과(Green)한다.
  - **구현 메모**: 부팅 동기화는 `await`하지 않고 `void runBootSync()`로 띄운다. 로컬 하이드레이션이 끝나는 즉시 화면을 그리고 서버 병합은 뒤에 붙인다 — 네트워크가 느린 교회에서 첫 화면이 밀리면 안 된다. 서버에서 받은 문서는 로컬에도 적어 둬야 다음 부팅에 네트워크 없이 열린다.

- [x] **Task 4.6: 동기화 상태 표시 연결**
  - **대상 파일**: `src/client/features/editor/EditorHeader.tsx`
  - **선행 조건**: Task 4.5
  - **구현 내용**:
    - 현재 '자동 저장됨'은 **데이터 바인딩이 전혀 없는 정적 초록 점**이라, 저장이 실패하는 중에도 '저장됨'이라고 한다
    - 실제 저장·동기화 상태로 연결한다 (저장 중 / 저장됨 / 동기화됨 / 오프라인)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/editor`가 100% 통과(Green)한다.
  - **구현 메모**: '오프라인'은 회색 점 + '오프라인 · 로컬 저장됨'으로 표시한다. 빨간색으로 칠하면 예배 중에 사고가 난 것처럼 보이는데, 실제로는 이 브라우저에 정상 저장된 상태다.

- [x] **Task 4.7: M3B-4 모노레포 전체 품질 검증**
  - **대상 파일**: 전체 워크스페이스
  - **선행 조건**: Task 4.6
  - **구현 내용**: `pnpm typecheck` / `pnpm lint` / `pnpm test` 전부 Green
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 에러 없이 성공(Exit code 0)한다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_6.md`(M3B-5)에서 가사 기여를 붙이고 M3-B 완료 기준을 통합 검증한다.
