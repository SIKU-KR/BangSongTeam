# Goal: [M3B-3] Hono RPC 클라이언트 및 로그인 게이트

> **마일스톤**: M3-B (계정·서버 저장)
> **태스크 번호**: `tasks_4.md`
> **선행 조건**: `docs/tasks/m3/tasks_3.md` 완료 (덱·프레젠테이션 CRUD API)
> **목표**: 프론트엔드를 `hc<AppType>` RPC로 서버에 연결하고, 로그인 없이는 편집·송출에 들어갈 수 없게 하되 **예배 당일 네트워크가 끊겨도 송출은 되게** 한다
> **완료 기준 (DoD)**: 미로그인 상태에서 어떤 경로로 들어와도 로그인 화면만 보이고, 로그인 후에는 세션 사용자로 작업이 저장되며, 네트워크를 끊어도 캐시된 세션으로 송출 화면이 뜬다

> **구현 현황 (2026-09-22)**
>
> - Task 3.1~3.8 완료. 전체 **457개 / 61파일 Green**.
> - Chrome에서 `/presentations`로 직접 들어가도 로그인 화면만 나오는 것을 확인했다. `/api/auth/sign-in/social`이 카카오·네이버 인가 URL을 올바른 `redirect_uri`로 돌려준다.
> - **실제 OAuth 왕복은 여전히 미검증이다** — 자격증명이 플레이스홀더라 인가 서버가 거절한다. 실제 값을 `.dev.vars`에 넣으면 바로 동작할 상태다.
> - ⚠️ **로컬 D1에 마이그레이션이 적용되어 있지 않아 로그인이 500으로 실패했다** (`no such table: verification`). `pnpm --filter @repo/db db:migrate:local`로 해결. CLAUDE.md §4.2의 설정 단계인데 이 워크스페이스에서는 빠져 있었다.
> - 게스트 경로 제거의 파급이 컸다: 테스트 9개 파일이 '부팅 시 샘플 5개가 있다'를 전제하고 있었다. `src/test/sessionFixture.ts`와 `__loadDocumentsForTests()`를 만들어 각 테스트가 필요한 상태를 직접 만들도록 바꿨다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **로그인은 전제 조건이다**: 사용자 결정(2026-09-22)에 따라 게스트 편집 경로를 제거한다. `prd.md:150`의 '로그인은 편집의 전제 조건이 아니다'와 충돌하므로 **문서도 같이 고친다**(`tasks_6.md`).
2. **부팅 시 서버 검증으로 게이트를 막지 않는다**: 캐시된 세션이 있으면 즉시 통과시키고 서버 재검증은 백그라운드로 돌린다. 예배 당일 네트워크가 끊겼는데 로그인 화면이 뜨면 서비스 전체가 실패한다.
3. **송출 경로는 네트워크를 쓰지 않는다**: `/present/*`는 하이드레이션된 메모리 상태만 읽는다. 동기화·세션 재검증이 여기서 돌면 안 된다.
4. **느슨한 fetch 금지**: 서버 통신은 `hc<AppType>` 한 곳을 통한다 (CLAUDE.md §6.1). `src/client`는 `packages/db`를 import하지 않는다.
5. **시드 샘플을 자동 생성하지 않는다**: 계정이 생긴 이상 첫 로그인 사용자는 빈 대시보드에서 시작한다. 샘플 5개를 계정에 심으면 그게 서버로 올라가 남의 데이터처럼 보인다.
6. **로컬 문서는 사용자별로 격리한다**: 한 브라우저에서 계정을 바꿔도 남의 문서가 보이면 안 된다. 로그아웃해도 로컬 데이터 자체는 지우지 않는다 (다시 로그인하면 그대로 써야 한다).

---

## 2. 세부 작업 체크리스트

- [x] **Task 3.1: Hono RPC 클라이언트 모듈**
  - **대상 파일**: `src/client/lib/api/client.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `hc<AppType>("/")` — `AppType`은 `worker/index.ts`에서 이미 export되어 있다
    - 쿠키 세션을 쓰므로 `credentials: "include"`를 기본으로 건다
    - 오프라인·네트워크 실패를 호출자가 구분할 수 있는 에러 타입을 함께 노출한다
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 3.2: 오프라인 세션 캐시 (TDD)**
  - **대상 파일**: `src/client/lib/auth/sessionCache.ts`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - httpOnly 쿠키는 JS가 못 읽으므로, 세션 확인에 성공할 때마다 `{ userId, name, image, expiresAt }`를 IndexedDB에 캐시한다
    - `OFFLINE_DB_VERSION`을 1 → 2로 올리고 `auth_session` 스토어를 추가한다
    - 만료된 캐시는 통과시키지 않는다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/auth/sessionCache.test.ts`가 100% 통과(Green)한다.

- [x] **Task 3.3: 세션 스토어 (TDD)**
  - **대상 파일**: `src/client/lib/auth/sessionStore.ts`
  - **선행 조건**: Task 3.2
  - **구현 내용**:
    - 상태: `loading` / `authenticated` / `unauthenticated`
    - `hydrateSession()` — **캐시를 먼저 보고 즉시 결론을 낸다.** 캐시가 있으면 authenticated로 열어 주고 서버 재검증은 백그라운드
    - 서버가 세션 없음을 확인하면 캐시를 비우고 unauthenticated로 내린다
    - 오프라인(네트워크 실패)은 '세션 없음'이 아니다. 캐시를 유지한다
    - `signInWithProvider(provider)`, `signOut()`
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/lib/auth/sessionStore.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: '오프라인'과 '세션 없음'을 반드시 구분한다. 세션 조회기는 서버가 확실히 답했을 때만 `null`을 돌리고, 네트워크에 닿지 못하면 던진다. 둘을 뭉뚱그리면 예배 당일 네트워크가 끊기는 순간 로그아웃되어 송출이 멈춘다.

- [x] **Task 3.4: 로그인 화면**
  - **대상 파일**: `src/client/routes/LoginRoute.tsx`
  - **선행 조건**: Task 3.3
  - **구현 내용**:
    - 카카오·네이버 로그인 버튼, 서비스 한 줄 소개
    - 로그인이 왜 필요한지 설명한다 (다른 PC에서 같은 세트를 열기 위함)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/routes/LoginRoute.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 3.5: 게스트 경로 제거 및 세션 사용자 연결**
  - **대상 파일**: `src/client/features/presentation/presentationStore.ts`, `src/client/features/editor/songLibraryStore.ts`
  - **선행 조건**: Task 3.3
  - **구현 내용**:
    - `createSeedState()`를 빈 컬렉션으로 바꾸고, 저장소가 비었을 때 샘플을 기록하던 분기를 제거한다
    - 세 파일에 흩어진 `GUEST_USER_ID`/`SEED_USER_ID`/`MOCK_USER_ID`(모두 같은 리터럴)를 세션 userId로 대체한다
    - `hydrateFromStorage()`가 로컬 문서를 세션 userId로 필터한다
    - `mockPresentations.ts`·`mockPresentation.ts`는 지우지 않고 테스트 픽스처로 남긴다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/presentation`이 100% 통과(Green)한다.
  - **구현 메모**: `resetActivePresentation()`의 의미가 '시드 복원'에서 '세트 비우기'로 바뀌었다. 시드가 사라진 이상 사용자가 만든 적 없는 곡이 복원되는 게 더 이상하다. `saveSongToLibrary()`는 세션이 없으면 던진다 — 빈 `userId`로 저장하면 `DeckSchema`(uuid)에서 터지거나, 더 나쁘게는 아무에게도 안 보이는 곡이 저장된다.

- [x] **Task 3.6: 앱 인증 게이트**
  - **대상 파일**: `src/client/App.tsx`
  - **선행 조건**: Task 3.4, Task 3.5
  - **구현 내용**:
    - 하이드레이션 게이트 다음에 인증 게이트를 둔다. 미인증이면 로그인 화면만 렌더한다
    - 세션 사용자가 정해진 뒤에 스토어를 하이드레이션한다 (사용자별 필터가 필요하므로 순서가 중요하다)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/App.test.tsx`가 100% 통과(Green)한다.
  - **구현 메모**: 세션을 먼저 확정한 다음 스토어를 싣는다. 두 하이드레이션 모두 세션 사용자로 문서를 거르므로 순서가 뒤집히면 빈 목록이 나온다.

- [x] **Task 3.7: 사이드바 계정 영역 연결**
  - **대상 파일**: `src/client/components/layout/AppSidebar.tsx`
  - **선행 조건**: Task 3.6
  - **구현 내용**:
    - '주일 찬양팀 / 로컬 오프라인 모드' 정적 아바타를 실제 세션 사용자로 교체하고 로그아웃을 붙인다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/components/layout`이 100% 통과(Green)한다.

- [x] **Task 3.8: M3B-3 모노레포 전체 품질 검증 및 브라우저 확인**
  - **대상 파일**: 전체 워크스페이스
  - **선행 조건**: Task 3.7
  - **구현 내용**:
    - `pnpm typecheck` / `pnpm lint` / `pnpm test` 전부 Green
    - Chrome에서 미로그인 시 로그인 화면만 보이는지 확인
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 에러 없이 성공(Exit code 0)한다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_5.md`(M3B-4)에서 스토어 변경을 서버로 밀어 올리는 동기화 계층을 붙인다.
