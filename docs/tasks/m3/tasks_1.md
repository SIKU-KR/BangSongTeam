# Goal: [M3A-1] 로컬 영속성 (IndexedDB Persistence Layer)

> **마일스톤**: M3-A (로컬 영속성)
> **태스크 번호**: `tasks_1.md`
> **선행 조건**: `docs/tasks/m2/tasks_5.md`의 Task 5.1~5.4 완료 (편집기·송출 라우트 동작)
> **목표**: 브라우저 메모리에만 존재하는 프레젠테이션 상태를 IndexedDB에 영속화하여, 새로고침·탭 종료·브라우저 재시작 후에도 작업이 그대로 복원되게 한다
> **완료 기준 (DoD)**: 브라우저를 완전히 종료한 뒤 다시 열어도 5곡 세트가 그대로 남아 있고, 그 세트로 주일 예배 1회를 송출한다

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **로컬이 1차 원천**: 이 단계에서 서버 API·로그인은 건드리지 않는다. `apps/web/src`에서 `fetch`를 추가하지 않는다. 서버 동기화는 M3-B다.
2. **스토어가 단일 진입점**: 영속화는 `presentationStore`의 뮤테이터 경로 한 곳에서만 일어난다. 컴포넌트가 직접 IndexedDB를 호출하지 않는다.
3. **저장 실패를 삼키지 않는다**: `QuotaExceededError`, 시크릿 모드, IndexedDB 차단 환경에서 조용히 인메모리로 폴백하지 않는다. 사용자에게 '이 브라우저에 저장할 수 없습니다'를 보여준다. 저장된 줄 알고 예배 당일에 잃는 것이 최악의 시나리오다.
4. **스키마 검증**: 저장본을 읽을 때 `PresentationSchema.safeParse`로 검증한다. 실패한 문서는 삭제하지 않고 격리 보관한다.
5. **DB 직접 임포트 금지**: `apps/web/src`는 `packages/db`를 import하지 않는다 (ESLint 강제).
6. **단일 원천 타입**: 저장 값의 타입은 `@repo/shared`의 `Presentation`/`Deck`을 그대로 쓴다. 저장 전용 interface를 새로 선언하지 않는다.
7. **TECH_SPEC §5.5 Phase 2 규칙**을 구현 기준으로 삼는다.

---

## 2. 세부 작업 체크리스트

### Phase M3A-1: 저장소 계층 (TDD)

- [ ] **Task 1.1: idb 및 테스트용 fake-indexeddb 설치**
  - **대상 파일**: `apps/web/package.json`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `idb`를 dependencies에 추가 (TECH_SPEC 7.7 지정 라이브러리)
    - `fake-indexeddb`를 devDependencies에 추가하고 `apps/web/src/test/setup.ts`에서 로드해 jsdom 환경에 IndexedDB를 제공
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [ ] **Task 1.2: 오프라인 DB 오픈 유틸리티 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `apps/web/src/lib/storage/db.test.ts`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - 테스트 1: `getOfflineDB()` 호출 시 `worship-offline-db` v1이 열리고 `presentations`·`decks`·`backgrounds`·`sync_meta` 스토어가 모두 생성된다
    - 테스트 2: `presentations`의 `by-date` 인덱스, `decks`의 `by-presentation` 인덱스가 존재한다
    - 테스트 3: 두 번 호출해도 같은 커넥션을 재사용한다 (매 호출 openDB 금지)
    - 테스트 4: IndexedDB를 사용할 수 없는 환경에서 예외를 던지되 원인을 식별 가능한 에러 타입으로 감싼다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/storage/db.test.ts`가 Red(구현 부재로 실패)를 명확히 보고한다.

- [ ] **Task 1.3: 오프라인 DB 오픈 유틸리티 구현 (TDD Green)**
  - **대상 파일**: `apps/web/src/lib/storage/db.ts`
  - **선행 조건**: Task 1.2
  - **구현 내용**:
    - TECH_SPEC §5.4-4의 `WorshipOfflineDB` 스키마(Version 1)를 그대로 구현
    - 모듈 스코프 싱글턴 Promise로 커넥션 재사용, `upgrade`에서 스토어·인덱스 생성
    - 사용 불가 환경을 위한 `isPersistenceAvailable()` 노출
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/storage/db.test.ts`가 100% 통과(Green)한다.

- [ ] **Task 1.4: 프레젠테이션 리포지토리 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `apps/web/src/lib/storage/presentationRepository.test.ts`
  - **선행 조건**: Task 1.3
  - **구현 내용**:
    - 테스트 1: `savePresentation(p)` 후 `loadAllPresentations()`가 동일 문서를 반환한다 (문서 단위 put)
    - 테스트 2: `deletePresentation(id)`가 문서와 종속 덱 레코드를 함께 지운다
    - 테스트 3: 스키마에 맞지 않는 저장본은 결과 목록에서 제외되고 `corrupted` 목록으로 따로 반환된다 (삭제하지 않는다)
    - 테스트 4: 저장 중 `QuotaExceededError`가 발생하면 삼키지 않고 호출자에게 전파한다
    - 테스트 5: 빈 저장소에서 `loadAllPresentations()`는 빈 배열을 반환한다 (에러 아님)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/storage/presentationRepository.test.ts`가 Red를 명확히 보고한다.

- [ ] **Task 1.5: 프레젠테이션 리포지토리 구현 (TDD Green)**
  - **대상 파일**: `apps/web/src/lib/storage/presentationRepository.ts`
  - **선행 조건**: Task 1.4
  - **구현 내용**:
    - `savePresentation` / `loadAllPresentations` / `deletePresentation` / `clearAll` 제공
    - 읽기 시 `PresentationSchema.safeParse` 검증, 실패분은 `corrupted`로 분리 반환
    - 문서 단위 전체 교체(put)로 기록해 마지막 쓰기 유실 시에도 직전 저장본이 남게 한다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/storage/presentationRepository.test.ts`가 100% 통과(Green)한다.

### Phase M3A-2: 스토어 연동

- [ ] **Task 2.1: presentationStore 영속성 연동 테스트 작성 (TDD Red)**
  - **대상 파일**: `apps/web/src/features/presentation/presentationStore.persistence.test.ts`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - 테스트 1: 임의 뮤테이터(`updateSongStyle` 등) 호출 후 디바운스 시간이 지나면 해당 문서 1건만 저장된다
    - 테스트 2: `hydrateFromStorage()`가 저장본으로 스토어를 초기화하고, 저장소가 비어 있을 때만 시드 데이터를 넣는다
    - 테스트 3: `flushPendingWrites()`가 대기 중인 디바운스 쓰기를 즉시 시작한다
    - 테스트 4: 저장이 실패하면 스토어의 `persistenceError` 상태가 세팅되고 편집 자체는 계속 가능하다
    - 테스트 5: undo/redo 히스토리는 저장 대상이 아니다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/presentation/presentationStore.persistence.test.ts`가 Red를 명확히 보고한다.

- [ ] **Task 2.2: presentationStore 영속성 연동 구현 (TDD Green)**
  - **대상 파일**: `apps/web/src/features/presentation/presentationStore.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `emitChange` 경로에 문서 단위 디바운스(≈300ms) 저장 스케줄러 연결
    - `hydrateFromStorage()` 추가 — `createSeedState()`는 '저장소가 비어 있을 때의 초기값'으로 격하
    - `flushPendingWrites()`, `persistenceError` 구독 훅(`usePersistenceError`) 노출
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/presentation`이 100% 통과(Green)한다.

- [ ] **Task 2.3: 앱 부팅 하이드레이션 게이트 및 언로드 flush 연결**
  - **대상 파일**: `apps/web/src/App.tsx`
  - **선행 조건**: Task 2.2
  - **구현 내용**:
    - 라우터 렌더 전에 `hydrateFromStorage()`를 1회 실행하고, 완료 전까지 초기 로딩 화면을 보여준다 (시드 데이터가 잠깐 보였다가 교체되는 깜빡임 금지)
    - `visibilitychange`(hidden)와 `pagehide`에서 `flushPendingWrites()` 호출
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/App.test.tsx`가 100% 통과(Green)한다.

- [ ] **Task 2.4: 저장 실패 경고 배너 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/components/common/StorageWarningBanner.tsx`
  - **선행 조건**: Task 2.2
  - **구현 내용**:
    - `persistenceError`가 있을 때 '이 브라우저에 저장할 수 없습니다 — 작업이 사라질 수 있습니다' 배너 표시
    - 용량 초과와 IndexedDB 사용 불가(시크릿 모드 등)를 구분해 안내
    - 편집기 화면 상단에 상시 노출하며 닫을 수 없게 한다 (`ChromeAlertBanner`와 달리 dismiss 금지)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/components/common/StorageWarningBanner.test.tsx`가 100% 통과(Green)한다.

### Phase M3A-3: 통합 검증

- [ ] **Task 3.1: 영속성 왕복(Round-trip) 통합 테스트 작성 및 통과**
  - **대상 파일**: `apps/web/src/features/presentation/persistenceRoundtrip.test.tsx`
  - **선행 조건**: Task 2.4
  - **구현 내용**:
    - 통합 시나리오: 새 세트 생성 → 가사 붙여넣기로 5곡 추가 → 곡 순서·스타일·배경 변경 → `flushPendingWrites()` → 스토어 리셋(새 탭 시뮬레이션) → `hydrateFromStorage()` → 곡 수·순서·스타일·배경이 모두 동일함을 검증
    - 송출 라우트가 하이드레이션된 데이터로 첫 슬라이드를 렌더링하는 것까지 확인
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/presentation/persistenceRoundtrip.test.tsx`가 100% 통과(Green)한다.

- [ ] **Task 3.2: M3-A 모노레포 전체 품질 검증**
  - **대상 파일**: 전체 워크스페이스
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - `pnpm typecheck` / `pnpm lint` / `pnpm test` 전부 Green
    - 수동 확인: Chrome에서 세트 편집 → 탭 완전 종료 → 재접속 시 동일 세트 복원
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 에러 없이 성공(Exit code 0)한다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 마일스톤 이후

M3-A가 끝나면 M1·M2의 완료 기준(실제 주일 예배 송출, 봉사자 15분 세트 구성)을 비로소 검증할 수 있다. 검증에서 나온 문제를 다음 작업의 맨 앞에 둔다(PRD 8장 규칙 3). 그 다음이 M2 잔여 3건 또는 M3-B(Hono RPC 클라이언트 + 계정·서버 저장)이며, 어느 쪽을 먼저 할지는 실사용에서 나온 문제의 성격으로 정한다.
