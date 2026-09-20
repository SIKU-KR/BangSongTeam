# Goal: [M0-1] 모노레포 환경 및 공통 설정

> **마일스톤**: M0 (인프라 및 기반 구성)  
> **태스크 번호**: `tasks_1.md`  
> **선행 조건**: 없음 (프로젝트 최초 초기화)  
> **목표**: pnpm 워크스페이스 구조를 수립하고, 전체 패키지가 공유할 엄격한 TypeScript 및 ESLint 아키텍처 가드레일(DB 패키지 격리)을 설정한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **패키지 격리 원칙**: `packages/db`는 Worker 백엔드 전용 패키지다. 프론트엔드(`apps/web/src`)에서 `packages/db`를 직접 임포트하는 행위를 ESLint `no-restricted-imports` 규칙으로 차단한다.
- **TypeScript 엄격 모드**: `strict: true`, `noImplicitAny: true`, `target: "ES2022"`, `moduleResolution: "Bundler"`를 기본 강제한다.

---

## 2. 세부 작업 체크리스트

- [ ] **Task 1.1: pnpm 워크스페이스 및 모노레포 루트 구성**
  - **대상 파일**: `pnpm-workspace.yaml`, `package.json`, `.gitignore`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `pnpm-workspace.yaml`에 `apps/*`, `packages/*`, `packages/config/*` 패키지 경로 선언
    - 루트 `package.json`에 `private: true`, `packageManager: "pnpm@9.x"`, 통합 스크립트(`typecheck`, `lint`, `test`, `format`, `dev`) 정의
    - `.gitignore`에 `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `.turbo` 등 제외 규칙 지정
  - **DoD (통과 기준)**: `pnpm install` 실행 시 에러 없이 `pnpm-lock.yaml` 파일이 정상 생성된다.

- [ ] **Task 1.2: 공유 TypeScript 기본 설정 패키지 구성**
  - **대상 파일**: `packages/config/typescript/package.json`, `packages/config/typescript/tsconfig.base.json`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - `@repo/typescript-config` 패키지 매니페스트 선언
    - `tsconfig.base.json`에 `strict: true`, `noImplicitAny: true`, `moduleResolution: "Bundler"`, `target: "ES2022"`, `skipLibCheck: true`, `declaration: true` 공통 컴파일러 옵션 명시
  - **DoD (통과 기준)**: 빈 tsconfig에서 `"extends": "@repo/typescript-config/tsconfig.base.json"` 참조 시 구문 에러가 발생하지 않는다.

- [ ] **Task 1.3: 공유 ESLint 설정 및 DB 패키지 프론트엔드 격리 규칙 구성**
  - **대상 파일**: `packages/config/eslint/package.json`, `packages/config/eslint/index.js`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - `@repo/eslint-config` 패키지 매니페스트 선언
    - `no-restricted-imports` 규칙을 선언하여 `apps/web/src` 파일에서 `@repo/db` 또는 `packages/db` 임포트 시 ESLint 에러를 발생시키는 규칙 정의
    - TypeScript 파서(`@typescript-eslint/parser`) 및 추천 린트 룰셋 연동
  - **DoD (통과 기준)**: 프론트엔드 경로(`apps/web/src/test.ts`)에서 `@repo/db` 임포트 시 ESLint 위반 에러가 정상 출력된다.

---

## 3. 검증 명령어

```bash
# 워크스페이스 의존성 설치 검증
pnpm install

# TypeScript 컴파일 검증
pnpm -r exec tsc --noEmit
```
