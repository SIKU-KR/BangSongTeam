# Goal: [M0-4] Cloudflare Worker 백엔드 & R2 연동 (apps/web/worker)

> **마일스톤**: M0 (인프라 및 기반 구성)  
> **태스크 번호**: `tasks_4.md`  
> **선행 조건**: `docs/tasks/m0/tasks_3.md` 완료  
> **목표**: Hono 기반 Cloudflare Worker API 서버를 구축하고, D1 및 R2 바인딩을 연동하며 초기 10개 배경 비디오 메타데이터를 시드하여 workerd 통합 테스트를 통과한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **엔드투엔드 타입 안전성**: Hono RPC Client와 `@hono/zod-validator`를 통해 컴파일 타임에 API 경로와 페이로드가 검증되어야 한다.
- **R2 Egress 무과금 직통**: 비디오 파일은 Worker를 우회하여 R2 Custom Domain(`media.domain.com`)을 통해 브라우저로 직통 스트리밍되며, Worker는 메타데이터 JSON만 반환한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 4.1: Cloudflare Worker 프로젝트 설정 및 Wrangler 바인딩 구성**
  - **대상 파일**: `wrangler.jsonc`, `apps/web/package.json`
  - **선행 조건**: `docs/tasks/m0/tasks_3.md`
  - **구현 내용**:
    - `wrangler.jsonc`에 `main: "worker/index.ts"`, D1 (`DB`), R2 (`MEDIA_BUCKET`), AI 바인딩 정의
    - `apps/web/package.json`에 `hono`, `@hono/zod-validator`, `@repo/shared`, `@repo/db` 의존성 및 `dev`, `deploy`, `types` 스크립트 추가
  - **DoD (통과 기준)**: `pnpm --filter web exec wrangler types` 실행 시 `worker-configuration.d.ts`가 정상 생성되고 `wrangler deploy --dry-run`이 성공한다.

- [x] **Task 4.2: 로컬 Miniflare 개발용 환경 변수 템플릿 작성**
  - **대상 파일**: `.dev.vars.example`
  - **선행 조건**: Task 4.1
  - **구현 내용**:
    - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `R2_PUBLIC_DOMAIN` 항목 명시
  - **DoD (통과 기준)**: `cp .dev.vars.example .dev.vars` 실행 시 누락된 필수 키가 없다.

- [x] **Task 4.3: Hono Worker 엔트리포인트 및 기본 미들웨어 구현**
  - **대상 파일**: `src/worker/index.ts`, `src/worker/types.ts`
  - **선행 조건**: Task 4.1
  - **구현 내용**:
    - `src/worker/types.ts`: Hono Context Bindings (`DB`, `MEDIA_BUCKET`, `userId` 등) 타입 선언
    - `src/worker/index.ts`: Hono 인스턴스 생성, `/api/health` 헬스체크 라우트, 글로벌 에러 핸들러 및 404 폴백 정의
  - **DoD (통과 기준)**: Worker 로컬 실행 시 `GET /api/health`가 `{ "status": "ok" }`를 200 OK로 반환한다.

- [x] **Task 4.4: 모션 배경 메타데이터 조회 Hono 라우트 구현**
  - **대상 파일**: `src/worker/routes/backgrounds.ts`
  - **선행 조건**: Task 4.3
  - **구현 내용**:
    - `GET /api/backgrounds`: D1 `backgrounds` 테이블에서 전체 배경 비디오 메타데이터 목록 조회 반환
    - R2 Custom Domain URL(`cdnUrl`, `posterUrl`) 조합 로직 포함
    - 메인 Hono 인스턴스에 라우트 마운트
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 backgrounds 라우트가 정상 동작한다.

- [x] **Task 4.5: 초기 10개 모션 루프 영상 D1 시드 스크립트 작성**
  - **대상 파일**: `src/db/seed/backgrounds.ts`, `src/db/seed/seed.sql`
  - **선행 조건**: Task 3.11, Task 4.4
  - **구현 내용**:
    - PRD M0 규격에 맞는 10개 기본 모션 비디오 메타데이터(분위기: 잔잔한/밝은/웅장한, 주조색: 따뜻한/차가운/어두운) 정의
    - D1 SQLite 로컬 및 원격에 삽입 가능한 시드 함수 작성
  - **DoD (통과 기준)**: 시드 스크립트 실행 후 D1 `backgrounds` 테이블 레코드 수가 10건이 된다.

- [x] **Task 4.6: Miniflare/workerd 환경 Worker 및 D1 통합 테스트 작성**
  - **대상 파일**: `src/worker/index.test.ts`
  - **선행 조건**: Task 4.3, Task 4.4, Task 4.5
  - **구현 내용**:
    - `@cloudflare/vitest-pool-workers`를 활용하여 실제 workerd 런타임에서 `/api/health` 및 `/api/backgrounds` 호출 테스트 작성
  - **DoD (통과 기준)**: `pnpm --filter web test` 실행 시 Worker 통합 테스트가 100% 통과한다.

---

## 3. 검증 명령어

```bash
# 로컬 D1 마이그레이션 적용
pnpm --filter @repo/db db:migrate:local

# 초기 배경 영상 시드 데이터 삽입
pnpm --filter @repo/db seed:local

# Worker 통합 테스트 실행 (workerd 런타임)
pnpm --filter web test
```
