# Goal: [M2-5] 세트 편집기 통합 및 전체화면 송출 연동 검증

> **마일스톤**: M2 (편집기)  
> **태스크 번호**: `tasks_5.md`  
> **선행 조건**: `docs/tasks/m2/tasks_4.md` 완료  
> **목표**: 3패널 세트 편집기 전체 라우트를 완성하고, 편집된 세트 데이터를 전체화면 송출 뷰로 연결하여 "처음 써 보는 봉사자 1명이 5곡 세트를 15분 안에 구성"하는 M2 완료 기준을 종합 검증한다.

> **구현 현황 (2026-09-21 재검토)**
>
> - Task 5.1~5.4 구현 완료: `EditorHeader.tsx`, `EditorRoute.tsx`, `FullscreenPresentRoute.tsx`, `App.tsx` 라우팅(`/editor/:presentationId`, `/present/:presentationId/fullscreen`).
> - Task 5.6의 검증 명령(`pnpm typecheck && pnpm lint && pnpm test`)은 현재 **통과한다** (테스트 324개 / 파일 46개 Green). 다만 선행 태스크 5.5와 '봉사자 1명이 15분 안에 5곡 구성' 실사용 확인이 남아 체크하지 않는다.
> - **잔여: Task 5.5 (15분 워크플로 통합 테스트)**, 그리고 M2 완료 선언을 위한 실사용 검증.
> - 실사용 검증은 저장 기능(M3-A 로컬 영속성)이 붙은 뒤에 한다. 지금은 새로고침 한 번에 세트가 사라져 15분 측정이 무의미하다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **송출 무결성 보장**: 편집기에서 수정한 곡별 스타일(오버레이, 폰트, 위치)과 비디오 배경이 `/present/fullscreen` 송출 화면에서도 단 1px의 오차 없이 동일하게 재현되어야 한다.
- **모노레포 경계 준수**: 프론트엔드(`apps/web/src`)가 `packages/db`를 참조하지 않고, 모든 타입은 `@repo/shared`의 Zod 스키마에서 유도한다.
- **M2 마일스톤 관찰 가능 완료 기준 달성**: "처음 써 보는 봉사자 1명이 도움 없이 5곡 세트를 15분 안에 구성"할 수 있도록 직관적인 UI 플로우와 즉각적인 피드백을 제공한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 5.1: 세트 편집기 상단 헤더 바 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/EditorHeader.tsx`
  - **선행 조건**: `docs/tasks/m2/tasks_4.md`
  - **구현 내용**:
    - 세트 제목 인라인 텍스트 편집 (예: '새 예배 프레젠테이션')
    - '새 곡 추가' 버튼 (클릭 시 `AddSongModal` 열기)
    - '전체화면 송출' 버튼 (클릭 시 현재 세트 데이터를 가지고 `/present/fullscreen`으로 이동)
    - '홈으로' 나가기 링크
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 버튼 클릭 시 올바른 이벤트 및 네비게이션이 실행된다.

- [x] **Task 5.2: 전체화면 송출 라우트(`FullscreenPresentRoute`)의 세트 주입 연동**
  - **대상 파일**: `apps/web/src/routes/FullscreenPresentRoute.tsx`
  - **선행 조건**: Task 5.1
  - **구현 내용**:
    - React Router `useLocation().state?.presentation` 또는 `localStorage`의 편집된 세트 데이터를 우선 로드
    - 전달받은 세트 데이터가 없으면 기존 `mockPresentation`로 우아하게 폴백
    - 편집기에서 설정한 곡별 배경, 오버레이, 폰트, 텍스트 박스 위치가 전체화면에서 100% 동일하게 반영
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 편집기에서 구성한 세트가 전체화면으로 송출된다.

- [x] **Task 5.3: 세트 편집기 전체 화면 라우트 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/routes/PresentationEditorRoute.tsx`
  - **선행 조건**: Task 5.1, Task 5.2
  - **구현 내용**:
    - 3패널 레이아웃 구성:
      - 상단: `EditorHeader`
      - 좌측: `SongListPanel` (곡 목록 및 드래그 정렬)
      - 중앙 상단: `EditorStagePreview` (16:9 인터랙티브 조작 스테이지)
      - 중앙 하단: `SlideStripPanel` (슬라이드 썸네일 스트립)
      - 우측: `SongPropertyPanel` (곡별 속성 제어 패널)
    - `usePresentationEditor` 훅으로 전체 상태 바인딩 및 변경사항 실시간 반영
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 브라우저 렌더링 시 3패널 레이아웃이 완벽히 표시된다.

- [x] **Task 5.4: 라우팅 등록 및 메인 홈 화면 세트 편집기 진입 카드 추가**
  - **대상 파일**: `apps/web/src/App.tsx`, `apps/web/src/routes/index.tsx`
  - **선행 조건**: Task 5.3
  - **구현 내용**:
    - `App.tsx`에 `/editor` 라우트 등록 (`PresentationEditorRoute`)
    - `index.tsx` 메인 홈 화면에 '세트 편집기 (15분 프레젠테이션 구성)' 카드 추가 및 `/editor` 링크 연결
    - 기존 '가사 빠른 입력' 및 'M1 송출 시작하기' 카드와 조화롭게 레이아웃 배치
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 홈 화면에서 `/editor` 진입 및 전체 화면 구성이 가능하다.

- [ ] **Task 5.5: M2 편집기 15분 5곡 세트 구성 워크플로우 통합 테스트 작성 및 통과**
  - **대상 파일**: `apps/web/src/features/editor/editorWorkflow.test.tsx`
  - **선행 조건**: Task 5.4
  - **구현 내용**:
    - 통합 테스트: 신규 세트 생성 $\rightarrow$ 가사 붙여넣기로 곡 추가 및 슬라이드 분할 $\rightarrow$ 곡 순서 변경 $\rightarrow$ 곡 속성(오버레이, 폰트, 3x3 위치) 변경 $\rightarrow$ 오버플로우 감지 및 송출 데이터 전달 검증
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/editor/editorWorkflow.test.tsx`가 100% 통과(Green)한다.

- [ ] **Task 5.6: M2 모노레포 전체 무결점 빌드 및 품질 검증**
  - **대상 파일**: `package.json` (전체 워크스페이스 검증 파이프라인)
  - **선행 조건**: Task 5.5
  - **구현 내용**:
    - `pnpm typecheck`: `apps/web`, `packages/shared`, `packages/db` 타입 에러 0건
    - `pnpm lint`: DB 프론트엔드 격리 규칙을 포함한 ESLint 에러 0건
    - `pnpm test`: 모든 단위 및 통합 테스트 100% Pass
    - M2 완료 기준: "처음 써 보는 봉사자 1명이 도움 없이 5곡 세트를 15분 안에 구성" 요건 달성 확인
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test` 명령어가 에러 없이 성공(Exit code 0)한다.

---

## 3. 검증 명령어

```bash
# M2 워크플로우 통합 테스트
pnpm --filter web vitest run src/features/editor/editorWorkflow.test.tsx

# 워크스페이스 전체 타입 검사
pnpm typecheck

# 워크스페이스 전체 ESLint 검사
pnpm lint

# 워크스페이스 전체 단위 및 통합 테스트 실행
pnpm test
```
