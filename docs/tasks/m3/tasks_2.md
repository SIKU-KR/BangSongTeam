# Goal: [M3B-1] 인증 기반 (Better Auth + 세션 미들웨어)

> **마일스톤**: M3-B (계정·서버 저장)
> **태스크 번호**: `tasks_2.md`
> **선행 조건**: `docs/tasks/m3/tasks_1.md` 완료 (로컬 영속성 + 실사용 검증)
> **목표**: Worker에 Better Auth를 붙여 카카오·네이버 소셜 로그인과 세션 검증을 세우고, 이후 모든 보호 API가 기댈 `requireAuth` 미들웨어를 만든다
> **완료 기준 (DoD)**: `/api/auth/*`가 응답하고, 세션이 없는 요청은 보호 라우트에서 401을 받으며, 세션이 있으면 `c.get("userId")`로 UUID 사용자 id를 읽을 수 있다

> **구현 현황 (2026-09-22)**
>
> - Task 1.1~1.9를 모두 구현했다. 워커 테스트 29개를 포함해 전체 **393개 / 56파일 Green**.
> - **실제 카카오·네이버 왕복 로그인은 아직 검증하지 않았다.** `.dev.vars`가 플레이스홀더라 OAuth 인가 서버까지 가지 못한다. 자격증명을 받은 뒤 `tasks_4.md`(로그인 UI)에서 확인한다.
> - 자격증명이 비어 있으면 해당 소셜 프로바이더를 아예 등록하지 않는다. 빈 문자열로 OAuth를 열어 두면 설정 실수가 런타임까지 숨는다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **id는 UUID여야 한다**: `@repo/shared`의 `DeckSchema.userId`·`PresentationSchema.userId`가 `z.string().uuid()`다. Better Auth 기본 id는 32자 nanoid라 그대로 두면 서버 응답이 전부 스키마 검증에서 터진다. `advanced.database.generateId`로 UUID를 강제한다. 스키마를 느슨하게 푸는 방향으로 도망가지 않는다.
2. **기존 D1 테이블을 그대로 쓴다**: `src/db/schema/auth.ts`의 `user`/`session`/`account`/`verification`은 이미 Better Auth v1 기본 단수 테이블명·컬럼과 일치한다. **새 마이그레이션을 만들지 않는다.**
3. **auth 인스턴스는 요청 스코프다**: Worker는 요청마다 `env`가 온다. 모듈 스코프 싱글턴으로 만들면 바인딩이 없는 시점에 초기화된다. `(env) => auth` 팩토리로 만든다.
4. **체인을 끊지 않는다**: `worker/index.ts`는 `AppType` 추론을 위해 단일 체인식이다. 체인에서 떨어진 `app.on(...)` 문장은 RPC 타입에서 누락된다.
5. **카카오는 이메일을 안 줄 수 있다**: `account_email`은 비즈 앱 심사를 통과해야 내려온다. 이메일이 없다고 가입이 실패하면 안 되므로 `mapProfileToUser`에서 합성 이메일로 폴백한다.
6. **DB 직접 임포트 금지**: 프론트엔드는 이 단계에서 건드리지 않는다. 로그인 UI는 `tasks_4.md`다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 1.1: better-auth 및 Drizzle 어댑터 설치**
  - **대상 파일**: `apps/web/package.json`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `better-auth@^1.7.5`, `@better-auth/drizzle-adapter@^1.7.5`를 dependencies에 추가
    - 카카오·네이버는 v1.6+ 내장 소셜 프로바이더이므로 `genericOAuth` 플러그인이 필요 없다
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 1.2: 로컬 개발 환경변수 자리 채우기**
  - **대상 파일**: `.dev.vars`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - `.dev.vars.example`을 기준으로 `BETTER_AUTH_SECRET`(32자 이상), `BETTER_AUTH_URL`, 카카오·네이버 클라이언트 자격증명을 채운다
    - 실제 자격증명 발급 전까지는 플레이스홀더로 두되, 값이 플레이스홀더일 때 어떤 동작이 되는지 Task 1.4의 auth 인스턴스에서 명시적으로 다룬다
  - **DoD (통과 기준)**: `.dev.vars`에 6개 키가 모두 존재한다 (`.gitignore` 대상이므로 커밋하지 않는다).

- [x] **Task 1.3: auth 인스턴스 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `src/worker/lib/auth.test.ts`
  - **선행 조건**: Task 1.2
  - **구현 내용**:
    - 테스트 1: `createAuth(env)`가 `/api/auth`를 basePath로 하는 인스턴스를 만든다
    - 테스트 2: 사용자 id 생성기가 UUID를 반환한다 (`DeckSchema.userId`의 `z.string().uuid()` 통과)
    - 테스트 3: 카카오 프로필에 이메일이 없으면 `mapProfileToUser`가 합성 이메일을 채운다
    - 테스트 4: 카카오 프로필에 이메일이 있으면 그 값을 그대로 쓴다
    - 테스트 5: 자격증명이 비어 있으면 해당 프로바이더를 등록하지 않는다 (빈 문자열로 OAuth를 열어 두지 않는다)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/lib/auth.test.ts`가 Red(구현 부재로 실패)를 명확히 보고한다.

- [x] **Task 1.4: auth 인스턴스 구현 (TDD Green)**
  - **대상 파일**: `src/worker/lib/auth.ts`
  - **선행 조건**: Task 1.3
  - **구현 내용**:
    - `createAuth(env: Bindings)` 팩토리로 `betterAuth()` 인스턴스 생성
    - `database: drizzleAdapter(createD1Client(env.DB), { provider: "sqlite", schema })`
    - `advanced.database.generateId`로 UUID 생성 강제
    - `socialProviders`에 카카오·네이버를 등록하되, 자격증명이 없으면 등록에서 제외
    - 카카오 `mapProfileToUser`로 이메일·닉네임·프로필 이미지 폴백 처리
    - 요청마다 새로 만들지 않도록 `env` 기준 캐시(같은 isolate 내 재사용)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/lib/auth.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: `advanced.database.generateId`에 별도 함수를 넘겼다. better-auth가 `"uuid"` 리터럴도 받지만, sqlite에서는 드라이버 함수가 아니라 자체 생성이라 동작이 같고 테스트에서 직접 검증하기 쉬운 쪽을 택했다. `AuthInstance` 타입은 `ReturnType<typeof betterAuth>`(제네릭 기본값)가 아니라 실제 팩토리에서 추론해야 한다 — 옵션 리터럴로 좁혀진 타입이라 기본값에는 대입되지 않는다. 또 `telemetry: { enabled: false }`를 켰다.

- [x] **Task 1.5: 세션 미들웨어 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `src/worker/middleware/auth.test.ts`
  - **선행 조건**: Task 1.4
  - **구현 내용**:
    - 테스트 1: 세션이 없으면 `requireAuth`가 401 JSON을 반환하고 다음 핸들러를 부르지 않는다
    - 테스트 2: 세션이 있으면 `c.get("userId")`에 사용자 id가 들어가고 핸들러가 실행된다
    - 테스트 3: 세션 조회가 예외를 던져도 500이 아니라 401로 처리한다 (만료·손상 쿠키가 서버 오류로 보이면 안 된다)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/middleware/auth.test.ts`가 Red를 명확히 보고한다.

- [x] **Task 1.6: 세션 미들웨어 구현 (TDD Green)**
  - **대상 파일**: `src/worker/middleware/auth.ts`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - `auth.api.getSession({ headers: c.req.raw.headers })`로 세션을 읽어 `c.set("userId", ...)`
    - `requireAuth` 미들웨어와, `userId: string`(non-optional)로 좁힌 `AuthedEnv` 타입을 함께 노출해 보호 라우트가 non-null 단언 없이 쓰게 한다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/middleware/auth.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.7: Worker 테스트 부트스트랩을 마이그레이션 기반으로 교체**
  - **대상 파일**: `src/worker/test/setup.ts`, `src/worker/test/env.d.ts`, `vitest.worker.config.ts`
  - **선행 조건**: Task 1.6
  - **구현 내용**:
    - 현재 `worker/index.test.ts`가 `env.DB.exec("CREATE TABLE ...")` 문자열로 테이블을 만든다. 인증·덱·프레젠테이션 테이블까지 손으로 베껴 쓰면 `0000_initial.sql`과 갈라진다
    - `migrations/0000_initial.sql`과 `0001_fts5.sql`을 읽어 `--> statement-breakpoint`로 나눠 적용하는 헬퍼를 만들어 공유한다 (`src/db/test-utils.ts`와 같은 방식)
    - `declare module "cloudflare:test"`의 `ProvidedEnv`에 인증 환경변수를 추가한다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/index.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: `readD1Migrations`(Node 측 설정에서 읽기) + `applyD1Migrations`(workerd 안에서 적용) 조합을 썼다. 테스트 파일마다 중복되던 `declare module "cloudflare:test"`는 `worker/test/env.d.ts` 한 곳으로 모았다.

- [x] **Task 1.8: Worker에 `/api/auth/*` 마운트 및 통합 테스트**
  - **대상 파일**: `src/worker/index.ts`
  - **선행 조건**: Task 1.7
  - **구현 내용**:
    - 단일 체인 안에서 `.on(["GET", "POST"], "/api/auth/*", ...)`로 Better Auth 핸들러를 연결
    - `wrangler.jsonc`의 `run_worker_first: ["/api/*"]`가 이미 이 경로를 덮으므로 설정 변경은 없다
    - 세션 없는 `/api/auth/get-session`이 500이 아니라 정상 응답(빈 세션)을 주는지 확인
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/`가 100% 통과(Green)한다.

- [x] **Task 1.9: M3B-1 모노레포 전체 품질 검증**
  - **대상 파일**: 전체 워크스페이스
  - **선행 조건**: Task 1.8
  - **구현 내용**:
    - `pnpm typecheck` / `pnpm lint` / `pnpm test` 전부 Green
    - 테스트 수가 `tasks_1.md` 종료 시점(374개)보다 줄지 않았는지 확인
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 에러 없이 성공(Exit code 0)한다.
  - **구현 메모**: 루트 `pnpm test`로 돌릴 때만 `@better-auth/telemetry`가 `node:os`를 import해 로드에 실패했다. 이 패키지는 exports에 `node` 조건을 갖고 있고, nodejs_compat이 켜진 workerd가 그 조건을 매칭한다. 풀 플러그인은 `resolve.conditions`에서만 `node`를 빼 주고 외부 모듈 해석은 손대지 않는다. `deps.optimizer.ssr.include`로 better-auth 계열을 번들에 포함시켜 해결했다. **프로덕션 빌드에는 영향이 없다** — `pnpm --filter web build` 결과 워커 번들에 `node:os`가 없는 것을 확인했다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_3.md`(M3B-2, 덱·프레젠테이션 서버 CRUD)가 이 미들웨어 위에 올라간다. 실제 카카오·네이버 로그인 왕복 검증은 자격증명을 받은 뒤 `tasks_4.md`(로그인 UI)에서 수행한다.
