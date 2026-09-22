# Goal: [M3B-6] 개발자 로그인 (OAuth 연결 전까지의 기본 로그인 경로)

> **마일스톤**: M3-B (계정·서버 저장)
> **태스크 번호**: `tasks_7.md`
> **선행 조건**: `docs/tasks/m3/tasks_6.md` 완료
> **목표**: 카카오·네이버 자격증명 없이도 로그인해 전체 기능을 쓸 수 있게 하되, **이 경로가 프로덕션에서 절대 동작하지 않도록** 막는다
> **완료 기준 (DoD)**: 로컬에서 버튼 한 번으로 로그인해 세트를 만들고 송출할 수 있고, 플래그가 없거나 호스트가 localhost가 아니면 404를 받는다

> **배경 (2026-09-22 결정)**: OAuth 앱 등록은 Redirect URI에 실제 도메인이 필요하다. 도메인 구입 전까지 카카오·네이버 연결을 미루고, 그동안 개발자 로그인을 기본 경로로 쓴다.

> **구현 현황 (2026-09-22)**
>
> - Task 6.1~6.7 완료. 전체 **521개 / 68파일 Green**.
> - 브라우저에서 개발자 로그인 → 세트 생성 → 곡 추가 → **로컬 IndexedDB를 통째로 삭제 후 재접속 → 서버에서 세트가 그대로 복원**되는 것을 확인했다. M3-B 완료 기준('다른 PC에서 로그인해 같은 세트')을 실제로 실증한 경로다.
> - ⚠️ **이 검증 중 심각한 버그를 발견해 고쳤다 (Task 6.7).** 로그인 게이트를 통과한 뒤 로그인하는 경로에서 스토어 하이드레이션과 동기화가 아예 돌지 않았다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **프로덕션에서 죽어 있어야 한다 (최우선)**: 개발자 로그인이 운영에 살아 있으면 누구나 아무 계정으로 로그인할 수 있다. **이중 방어**로 막는다 — ① `DEV_LOGIN_ENABLED=true` 명시적 플래그, ② 요청 호스트가 `localhost`/`127.0.0.1`일 것. 플래그가 실수로 운영에 들어가도 실제 도메인에서는 여전히 죽는다.
2. **진짜 세션을 발급한다**: 가짜 우회 경로를 만들지 않는다. Better Auth의 세션·쿠키를 그대로 쓴다. 그래야 나머지 코드가 OAuth 로그인과 똑같이 동작하고, 나중에 OAuth를 붙일 때 검증이 무효가 되지 않는다.
3. **id는 여전히 UUID다**: `advanced.database.generateId`가 이미 UUID를 강제한다. 개발자 계정도 `DeckSchema.userId`를 통과해야 한다.
4. **여러 계정을 만들 수 있어야 한다**: 교차 사용자 격리와 2-기기 동기화를 손으로 확인하려면 개발자 계정이 둘 이상 필요하다.
5. **UI가 개발용임을 숨기지 않는다**: 로그인 화면에 개발용 표시를 남긴다.
6. **OAuth 버튼은 설정되어 있을 때만 보인다**: 플레이스홀더 자격증명으로 버튼을 띄우면 누를 때마다 인가 서버가 거절한다. 서버가 실제 설정된 프로바이더만 알려 준다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 6.1: 개발자 로그인 가드 및 auth 옵션 연결 (TDD)**
  - **대상 파일**: `apps/web/worker/lib/auth.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `isDevLoginEnabled(env, requestUrl)` — 플래그와 localhost 호스트를 **모두** 만족할 때만 true
    - 개발자 로그인이 켜진 경우에만 `emailAndPassword.enabled`를 true로 둔다 (꺼져 있으면 better-auth의 비밀번호 엔드포인트 자체가 없다)
    - `configuredSocialProviders(env)` — 자격증명이 실제로 채워진 프로바이더 목록
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/lib/auth.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: 방어선이 3겹이다. ① 플래그, ② localhost 호스트, ③ 플래그가 꺼져 있으면 better-auth가 비밀번호 엔드포인트 자체를 만들지 않는다. 라우트 가드가 뚫려도 로그인할 방법이 없다.

- [x] **Task 6.2: 개발자 로그인 라우트 (TDD)**
  - **대상 파일**: `apps/web/worker/routes/devLogin.ts`
  - **선행 조건**: Task 6.1
  - **구현 내용**:
    - `GET /api/auth-config` — `{ providers, devLogin }`. 로그인 화면이 무엇을 그릴지 정하는 근거
    - `POST /api/dev-login` — 고정 비밀번호로 가입(최초) 후 로그인. Better Auth가 만든 `Set-Cookie`를 그대로 전달한다
    - 선택 `email`을 받아 개발자 계정을 여러 개 만들 수 있게 한다
    - 비활성 상태에서는 404 (존재 자체를 드러내지 않는다)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/routes/devLogin.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: `asResponse: true`는 실패해도 던지지 않고 4xx Response를 돌려준다. try/catch로는 '계정 없음'을 못 잡아 상태 코드를 본다. 기본 계정은 `dev@worship.local` — `dev@localhost`는 better-auth의 이메일 검증(도메인에 점 필요)을 통과하지 못하고, `.local`은 실제로 등록될 수 없는 예약 TLD다.

- [x] **Task 6.3: 라우트 마운트 및 환경변수 문서화**
  - **대상 파일**: `apps/web/worker/index.ts`, `apps/web/worker/types.ts`, `apps/web/.dev.vars.example`
  - **선행 조건**: Task 6.2
  - **구현 내용**:
    - 단일 체인 안에 마운트한다
    - `DEV_LOGIN_ENABLED` 바인딩을 선언하고 예시 파일에 **운영에 넣지 말라는 경고와 함께** 문서화한다
    - OAuth 자격증명 예시는 빈 값으로 두어 '미설정'이 기본이 되게 한다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/`가 100% 통과(Green)한다.

- [x] **Task 6.4: 로그인 화면 연결**
  - **대상 파일**: `apps/web/src/routes/LoginRoute.tsx`
  - **선행 조건**: Task 6.3
  - **구현 내용**:
    - 부팅 시 `/api/auth-config`를 읽어 설정된 프로바이더만 버튼으로 그린다
    - 개발자 로그인이 켜져 있으면 버튼과 '개발용' 표시를 함께 보여준다
    - 계정을 바꿔 시험할 수 있도록 이메일 입력을 선택적으로 제공한다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/routes/LoginRoute.test.tsx`가 100% 통과(Green)한다.
  - **구현 메모**: 어떤 로그인 수단을 그릴지는 서버가 정한다. 플레이스홀더 자격증명으로 소셜 버튼을 띄우면 누를 때마다 인가 서버가 거절한다.

- [x] **Task 6.5: 브라우저 실사용 확인**
  - **대상 파일**: 없음 (검증)
  - **선행 조건**: Task 6.4
  - **구현 내용**:
    - Chrome에서 개발자 로그인 → 세트 생성 → 새로고침 후 복원 → 송출까지 확인
    - 서버에 문서가 실제로 저장되는지(D1) 확인
  - **DoD (통과 기준)**: 로그인 후 `/presentations`가 열리고, 만든 세트가 새로고침 뒤에도 남는다.

- [x] **Task 6.7: 게이트 통과 후 로그인 시 부트스트랩이 돌지 않는 결함 수정 (실사용 검증 중 발견)**
  - **대상 파일**: `apps/web/src/App.tsx`
  - **선행 조건**: Task 6.5
  - **구현 내용**:
    - 부트스트랩(`hydrateFromStorage`·`hydrateSongLibrary`·`runBootSync`)이 `useEffect(..., [])`로 **부팅 때 한 번만** 돌았다. 부팅 시점에 미인증이면 영영 돌지 않는다
    - 그 결과 방금 로그인한 사용자는 **서버 동기화가 꺼져 있고**(`setSyncEnabled`가 `runBootSync` 안에 있다), **로컬 저장조차 되지 않았다**(`persistenceEnabled`가 `hydrateFromStorage` 안에서만 켜진다). 새로고침하기 전까지 만든 세트가 어디에도 저장되지 않는다
    - 세션이 `authenticated`가 되고 `userId`가 바뀔 때마다 부트스트랩을 다시 돌리도록 고쳤다. 개발자 로그인·OAuth 콜백 복귀·계정 전환이 모두 같은 경로를 탄다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/App.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 6.6: 전체 품질 검증**
  - **대상 파일**: 전체 워크스페이스
  - **선행 조건**: Task 6.7
  - **구현 내용**: `pnpm typecheck` / `pnpm lint` / `pnpm test` 전부 Green
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 에러 없이 성공(Exit code 0)한다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

도메인을 구입하면 카카오·네이버 개발자 콘솔에 Redirect URI를 등록하고 `wrangler secret put`으로 자격증명을 넣는다. `DEV_LOGIN_ENABLED`는 **운영 시크릿에 절대 넣지 않는다.**
