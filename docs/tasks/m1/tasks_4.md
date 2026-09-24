# Goal: [M1-4] 전체화면 송출 뷰 및 M0/M1 최종 통합 검증

> **마일스톤**: M1 (송출 코어 엔진)  
> **태스크 번호**: `tasks_4.md`  
> **선행 조건**: `docs/tasks/m1/tasks_3.md` 완료  
> **목표**: 청중용 단독 전체화면 송출 뷰와 라우팅을 완성하고, M0과 M1의 모든 요건(무결점 스테이지, 100ms 키패드 반응, 무에러 빌드)을 종합 검증한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **Zero-Network Presentation Invariant**: 송출 화면이 활성화된 동안에는 외부 네트워크 요청이 0건이어야 하며 네트워크 단절 상태에서도 5곡 세트 전체 송출이 완주되어야 한다.
- **M0 & M1 마일스톤 완료 기준 달성**: "로그인 없이 만든 5곡 세트로 본인 교회 주일 예배 1회 송출" 관찰 가능 기준을 만족한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 4.1: 청중용 단독 전체화면 송출 페이지 구현**
  - **대상 파일**: `src/client/routes/FullscreenPresentRoute.tsx`
  - **선행 조건**: `docs/tasks/m1/tasks_3.md`
  - **구현 내용**:
    - 인메모리 5곡 세트 데이터를 로드하고 현재 곡/슬라이드 인덱스 상태 관리
    - `SlideStage`를 마운트하고 `usePresentationShortcuts`를 바인딩하여 키보드/리모컨으로 이전/다음/점프 제어
    - Fullscreen API(`document.documentElement.requestFullscreen()`) 연동
    - 청중 화면에 불필요한 번호 버퍼 텍스트나 UI가 노출되지 않도록 완전 차단
    - 송출 중 네트워크 요청 0건 검증 (Zero-Fetch Invariant)
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 전체화면 전환 및 방향키/키패드 점프가 화면 왜곡 없이 동작한다.

- [x] **Task 4.2: React Router 라우팅 등록 및 메인 홈 진입 화면 구현**
  - **대상 파일**: `src/client/routes/index.tsx`, `src/client/App.tsx`
  - **선행 조건**: Task 4.1
  - **구현 내용**:
    - React Router 라이브러리 모드 설정 (`/`, `/present/fullscreen`)
    - 메인 홈 화면: 상단 `ChromeAlertBanner`, 'M1 송출 시작하기 (5곡 세트)', '가사 빠른 입력' 카드 배치
    - 버튼 클릭 시 `/present/fullscreen`으로 전환
  - **DoD (통과 기준)**: 브라우저에서 `/` 접속 시 홈 화면이 뜨고, 송출 버튼 클릭 시 `/present/fullscreen`으로 전환된다.

- [x] **Task 4.3: M0 & M1 전체 모노레포 무결점 통합 검증**
  - **대상 파일**: `package.json` (전체 검증 파이프라인)
  - **선행 조건**: Task 4.1, Task 4.2
  - **구현 내용**:
    - `pnpm typecheck`: `apps/web`, `packages/shared`, `packages/db` 타입 에러 0건
    - `pnpm lint`: DB 프론트엔드 격리 규칙을 포함한 ESLint 위반 0건
    - `pnpm test`: 모든 단위 테스트(가사 분할, FTS5 새니타이저, 네비게이션 버퍼, 스키마) 및 Worker 통합 테스트 100% Green
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test` 명령어가 단 1개의 오류나 경고 없이 성공한다.

---

## 3. 검증 명령어

```bash
# 워크스페이스 전체 타입 검사
pnpm typecheck

# 워크스페이스 전체 ESLint 검사
pnpm lint

# 워크스페이스 전체 단위 및 통합 테스트 실행
pnpm test
```
