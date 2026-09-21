# Goal: [M2-1] 의존성 패키지, 오버플로우 감지 및 편집기 상태 엔진

> **마일스톤**: M2 (편집기)  
> **태스크 번호**: `tasks_1.md`  
> **선행 조건**: `docs/tasks/m1/tasks_4.md` 완료  
> **목표**: 15분 세트 구성을 위한 기반 라이브러리(`react-moveable`, `@dnd-kit`, `react-colorful`, 번들 폰트)를 셋업하고, 텍스트 넘침(Overflow) 감지 유틸리티와 편집기 상태 머신(`useSetlistEditor`)을 TDD로 구축한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **단일 원천 상태(Single Source of Truth)**: 곡(Deck)과 세트(Setlist)의 데이터 모델 및 스타일은 `@repo/shared`의 Zod 스키마(`DeckStyleSchema`, `SlideSchema`, `SetlistSchema`)를 엄격히 준수하며 수동 interface를 중복 생성하지 않는다.
- **오프라인 폰트 보장**: 폰트는 npm 번들(`pretendard`, `@fontsource/noto-sans-kr`)로만 제공하며 외부 Google Fonts 등 CDN 요청을 완전히 배제한다.
- **불변성 상태 관리**: 세트 편집기 상태 머신은 `useReducer`를 사용하여 불변 상태 업데이트를 보장하고, 실행 취소나 향후 히스토리 관리에 적합한 순수 함수 구조를 유지한다.

---

## 2. 세부 작업 체크리스트

- [ ] **Task 1.1: M2 필수 라이브러리 설치 및 웹폰트 번들 추가**
  - **대상 파일**: `apps/web/package.json`, `apps/web/src/index.css`
  - **선행 조건**: `docs/tasks/m1/tasks_4.md`
  - **구현 내용**:
    - `apps/web`에 필수 라이브러리 설치:
      - `react-moveable`: 텍스트 박스 인터랙티브 드래그, 리사이즈, 스냅 가이드라인
      - `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`: 곡 목록 드래그 앤 드롭 순서 변경
      - `react-colorful`: 텍스트 색상 컬러피커
      - `@fontsource/noto-sans-kr`: 번들 한글 웹폰트 추가
    - `apps/web/src/index.css`에 `@fontsource/noto-sans-kr` import 추가
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 라이브러리 import 에러 없이 번들링 준비가 완료된다.

- [ ] **Task 1.2: 텍스트 박스 폭 및 높이 넘침(Overflow) 감지 유틸리티 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `packages/shared/src/utils/overflow.test.ts`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - 테스트 케이스 1: 단일 줄 글자 수가 텍스트 박스 폭(`widthPercent`)을 초과하는지 여부 판별 (`isLineOverflowing`)
    - 테스트 케이스 2: 한 슬라이드가 4줄을 초과하거나 높이 임계치를 초과하는지 감지 (`checkSlideOverflow`)
    - 테스트 케이스 3: 곡 내 최다 줄 슬라이드가 스테이지 상하 5% 안전 여백을 벗어나는지 감지 (`checkSongStageOverflow`)
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared vitest run src/utils/overflow.test.ts` 실행 시 구현체가 없어 실패(Red)함을 확인한다.

- [ ] **Task 1.3: 텍스트 박스 폭 및 높이 넘침(Overflow) 감지 유틸리티 구현 (TDD Green)**
  - **대상 파일**: `packages/shared/src/utils/overflow.ts`, `packages/shared/src/utils/index.ts`
  - **선행 조건**: Task 1.2
  - **구현 내용**:
    - 한글(약 1.8~2.0배 폭 가중치) 및 영문 문자폭을 고려한 가상 너비 계산 알고리즘 구현
    - 슬라이드별 폭 초과 줄바꿈 경고 및 4줄 초과 경고 불리언 플래그 반환
    - 곡 내 최다 줄 슬라이드 스테이지 이탈 여부 계산 함수 구현 및 shared 패키지 export
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared vitest run src/utils/overflow.test.ts`가 100% 통과(Green)한다.

- [ ] **Task 1.4: 세트 편집기 상태 머신 리듀서 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `apps/web/src/features/editor/useSetlistEditor.test.ts`
  - **선행 조건**: Task 1.3
  - **구현 내용**:
    - 테스트 케이스 1: 곡 선택(`selectSong`), 슬라이드 선택(`selectSlide`) 인덱스 상태 갱신
    - 테스트 케이스 2: 곡 순서 재정렬(`reorderSongs(fromIndex, toIndex)`) 시 세트 배열 갱신
    - 테스트 케이스 3: 곡 추가(`addSong`) 및 곡 삭제(`removeSong`) 동작
    - 테스트 케이스 4: 곡 스타일 부분 변경(`updateSongStyle`) 및 기본값 복원(`resetSongStyle`)
    - 테스트 케이스 5: 슬라이드 분할(`splitSlide`), 다음 슬라이드와 합치기(`mergeSlideWithNext`), 슬라이드 추가/삭제
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/editor/useSetlistEditor.test.ts` 실행 시 구현체가 없어 실패(Red)함을 확인한다.

- [ ] **Task 1.5: 세트 편집기 상태 관리 훅 구현 (TDD Green)**
  - **대상 파일**: `apps/web/src/features/editor/useSetlistEditor.ts`
  - **선행 조건**: Task 1.4
  - **구현 내용**:
    - `useReducer` 기반 세트 편집기 상태 관리 (`setlist`, `selectedSongIndex`, `selectedSlideIndex`, `isDirty`)
    - mockSetlist 또는 신규 빈 세트리스트를 초기값으로 주입 가능한 팩토리 제공
    - 불변성을 보장하는 액션 디스패처 인터페이스 노출
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/editor/useSetlistEditor.test.ts`가 100% 통과(Green)한다.

---

## 3. 검증 명령어

```bash
# 오버플로우 감지 유틸리티 테스트
pnpm --filter @repo/shared vitest run src/utils/overflow.test.ts

# 편집기 상태 머신 테스트
pnpm --filter web vitest run src/features/editor/useSetlistEditor.test.ts

# 프론트엔드 타입 검사
pnpm --filter web typecheck
```
