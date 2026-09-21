# Tasks: [M2] 세트 편집기 (Setlist Editor)

> **마일스톤**: M2 (편집기)  
> **상위 문서**: [`prd.md`](./prd.md), [`AGENTS.md`](./AGENTS.md), [`docs/tasks/AGENTS.md`](./docs/tasks/AGENTS.md)  
> **목표**: 준비 시간 15분 목표 달성을 위한 세트 편집기(곡 목록 드래그 정렬, 16:9 인터랙티브 텍스트 박스 조작, 슬라이드 스트립, 곡별 배경·오버레이·타이포그래피·3×3 위치 속성 제어, 멜론/벅스 검색 링크) 구축  
> **완료 기준 (DoD)**: 처음 써 보는 봉사자 1명이 도움 없이 5곡 세트를 15분 안에 구성할 수 있는 무결점 인터페이스 완성

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **DOM 3-Layer 렌더링 엔진 불변성**: 편집기 미리보기에서도 `SlideStage`의 3-Layer(Layer 1: Video, Layer 2: Black Overlay, Layer 3: Typography) 구조를 100% 동일하게 재사용하며, 캔버스(Canvas)나 외부 슬라이드 프레임워크(Reveal.js 등)로 대체하지 않는다.
2. **단일 원천 상태(Single Source of Truth)**: 곡(Deck)과 세트(Setlist)의 데이터 모델 및 스타일은 `@repo/shared`의 Zod 스키마(`DeckStyleSchema`, `SlideSchema`, `SetlistSchema`)를 엄격히 준수하며 수동 interface를 중복 생성하지 않는다.
3. **5% 안전 여백 및 기준점 성장 규칙**:
   - 텍스트 박스는 화면 가장자리 5% 안쪽(`SAFE_MARGIN_PERCENT`: 5% ~ 95%)에서만 이동 가능하다.
   - 박스 높이는 가사 줄 수에 맞춰 기준점(Anchor)에서 자연스럽게 자란다 (`bottom-*`은 위로, `middle-*`은 상하 대칭으로, `top-*`은 아래로 성장).
   - 드래그 또는 폭 리사이즈 시 앵커는 `'custom'`으로 자동 전환된다.
4. **오프라인 및 로컬 폰트 보장**: 폰트는 npm 번들(`pretendard`, `@fontsource/noto-sans-kr`)로만 제공하며 외부 Google Fonts 등 CDN 요청을 완전히 배제한다.
5. **DB 직접 임포트 금지**: `apps/web`은 `packages/db`를 직접 import하지 않는다.

---

## 2. 세부 작업 체크리스트

### Phase M2-1: 의존성 패키지 구성, 오버플로우 감지 유틸리티 및 편집기 상태 엔진 (TDD)

- [ ] **Task 1.1: M2 필수 라이브러리 설치 및 웹폰트 번들 추가**
  - **대상 파일**: `apps/web/package.json`, `apps/web/src/index.css`
  - **선행 조건**: M1 완료 (`docs/tasks/m1/tasks_4.md`)
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

### Phase M2-2: 좌측 곡 목록 패널(드래그 정렬) 및 가사 분할/합치기 수동 편집 모달

- [ ] **Task 2.1: 드래그 앤 드롭 정렬 가능한 곡 리스트 아이템 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/SongListItem.tsx`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - `@dnd-kit/sortable`의 `useSortable` 훅 연동 (`transform`, `transition`, `listeners`, `attributes`)
    - 곡 번호(`1.`, `2.`), 곡 제목, 아티스트, 슬라이드 수 배지 렌더링
    - 오버플로우 발생 시 시각적 경고 아이콘(`⚠️`) 노출
    - 선택 활성화(Active) 하이라이트 스타일 및 곡 삭제(`onDelete`) 버튼 제공
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 곡 카드 렌더링 및 클릭/삭제 이벤트가 정상 동작한다.

- [ ] **Task 2.2: 좌측 곡 목록 및 드래그 정렬 패널 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/SongListPanel.tsx`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `@dnd-kit/core`의 `DndContext`, `SortableContext`, `closestCenter` 알고리즘 적용
    - `onDragEnd` 핸들러에서 인덱스 교체 후 `reorderSongs` 디스패치
    - 상단 '곡 목록' 타이틀 및 '곡 추가(+)' 버튼 배치
    - 곡 클릭 시 `selectSong` 호출로 활성 곡 전환
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 드래그 앤 드롭을 통한 곡 순서 변경이 정상 작동한다.

- [ ] **Task 2.3: 슬라이드 수동 분할/합치기 로직 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `apps/web/src/features/editor/manualLyricSplit.test.ts`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - 테스트 케이스 1: 특정 커서 줄 위치에서 슬라이드 나누기(`splitSlideAtLine`) 시 2개 슬라이드로 분할
    - 테스트 케이스 2: 현재 슬라이드를 다음 슬라이드와 합치기(`mergeWithNextSlide`) 시 개행 문자 결합 및 슬라이드 수 감소
    - 테스트 케이스 3: 슬라이드 내 빈 줄 정리 및 4줄 초과 시 자동 줄바꿈 분할 규칙 정합성 검증
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/editor/manualLyricSplit.test.ts` 실행 시 실패(Red)함을 확인한다.

- [ ] **Task 2.4: 슬라이드 수동 분할/합치기 로직 및 분할 미리보기 카드 컴포넌트 구현 (TDD Green)**
  - **대상 파일**: `apps/web/src/features/editor/manualLyricSplit.ts`, `apps/web/src/features/editor/LyricSlideCard.tsx`
  - **선행 조건**: Task 2.3
  - **구현 내용**:
    - 슬라이드 텍스트 분할/합치기 순수 함수 구현
    - `LyricSlideCard`: 분할된 슬라이드의 각 줄 표시, 줄 사이 '여기서 나누기' 버튼, 카드 하단 '다음 슬라이드와 합치기' 버튼
    - 4줄 초과 시 경고 배지 및 줄 수 표시
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/editor/manualLyricSplit.test.ts`가 100% 통과(Green)한다.

- [ ] **Task 2.5: 세트 곡 추가 및 가사 편집 통합 모달 구현**
  - **대상 파일**: `apps/web/src/features/editor/AddSongModal.tsx`
  - **선행 조건**: Task 2.4
  - **구현 내용**:
    - 곡 제목 및 아티스트 입력 폼
    - `ExternalSearchLinks` 연동 (멜론 및 벅스 검색 링크 새 탭 열기)
    - 원문 가사 텍스트에어리어 + 실시간 `splitLyricsIntoSlides` 분할 프리뷰
    - 각 분할 슬라이드에 `LyricSlideCard` 렌더링 (수동 나누기/합치기 실시간 반영)
    - '세트에 추가' 클릭 시 기본 스타일을 가진 신규 Deck을 생성하여 `addSong` 디스패치
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 가사 입력, 분할 조정 후 세트 곡 추가가 정상 수행된다.

---

### Phase M2-3: 중앙 16:9 인터랙티브 스테이지 & 하단 슬라이드 스트립

- [ ] **Task 3.1: react-moveable 기반 텍스트 박스 조작 오버레이 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/MoveableTextBox.tsx`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - 1920x1080 가상 스테이지 좌표계 내부에서 동작하는 `Moveable` 래퍼 컴포넌트
    - 드래그 이동(draggable): 5% 안전 여백(`SAFE_MARGIN_PERCENT`: 5% ~ 95%) 경계 제한
    - 좌우 폭 조절(resizable: left, right): 최소 20%, 최대 90% 제한
    - 드래그 또는 폭 조절 종료 시 `xPercent`, `yPercent`, `widthPercent` 계산 후 `updateSongStyle` 호출 (`anchor: 'custom'`)
    - 가로·세로 중앙선(50%) 스냅 가이드라인 실시간 감지 및 표시
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 텍스트 박스 드래그 및 폭 조절 시 퍼센트 좌표가 계산된다.

- [ ] **Task 3.2: 16:9 편집 미리보기 인터랙티브 스테이지 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/EditorStagePreview.tsx`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - 기존 `SlideStage` 위에 `MoveableTextBox` 및 중앙선 스냅 가이드라인 오버레이 렌더링
    - 최다 줄 슬라이드의 스테이지 이탈 경고 표시 (`checkSongStageOverflow` 연동)
    - 현재 선택된 슬라이드의 가사 및 곡 스타일(폰트, 크기, 오버레이, 그림자) 1:1 실시간 반영
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 스테이지 위에서 텍스트 조작 및 경고가 올바르게 렌더링된다.

- [ ] **Task 3.3: 하단 슬라이드 썸네일 스트립 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/SlideStripPanel.tsx`
  - **선행 조건**: Task 3.2
  - **구현 내용**:
    - 현재 활성 곡의 모든 슬라이드를 가로 스크롤 카드 스트립으로 표시
    - 슬라이드 번호(`1.1`, `1.2`, ...) 및 가사 텍스트 요약 렌더링
    - 슬라이드 카드 클릭 시 `selectSlide` 호출로 활성 슬라이드 전환
    - 슬라이드 추가(+) 및 삭제 버튼 제공
    - 개별 슬라이드의 글자 폭 초과 또는 줄 수 초과 시 경고 배지(`⚠️`) 표시
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 슬라이드 스트립 클릭 및 추가/삭제가 정상 동작한다.

---

### Phase M2-4: 우측 곡 속성 패널 & 모션 배경 라이브러리 모달

- [ ] **Task 4.1: 사전 주입 루프 배경 영상 선택 모달 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/BackgroundPickerModal.tsx`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - M0에서 사전 주입된 배경 영상 10종(R2 비디오 URL 및 포스터) 그리드 렌더링
    - 태그 필터 탭 (전체, 차분한, 밝은, 웅장한, 자연 등)
    - 카드 호버 시 `<video>` 자동 재생 미리보기, 마우스 이탈 시 일시 정지
    - 배경 클릭 선택 시 `updateSongBackground` 호출 및 모달 닫기
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 호버 재생 및 배경 선택 콜백이 정상 작동한다.

- [ ] **Task 4.2: 타이포그래피 및 가독성 오버레이 컨트롤 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/TypographyControls.tsx`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - 검정 오버레이 불투명도 슬라이더 (0% ~ 100%, 1% 단위 숫자 표시)
    - 폰트 셀렉트 (Pretendard, Noto Sans KR, Nanum Myeongjo, Gmarket Sans, KoPubWorld Batang)
    - 글자 크기 슬라이더 (`fontSizeVw`: 2.0 ~ 10.0, 0.1vw 단위)
    - 텍스트 정렬 버튼 그룹 (좌, 중, 우)
    - 텍스트 그림자 4단계 세그먼트 버튼 (`none`, `soft`, `medium`, `strong`)
    - 텍스트 색상 선택: `react-colorful` 팝오버 및 프리셋 색상 스와치 버튼
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 각 컨트롤 값 변경 시 `updateSongStyle`이 호출된다.

- [ ] **Task 4.3: 3×3 격자 앵커 프리셋 및 폭 조절 컨트롤 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/PositionControls.tsx`
  - **선행 조건**: Task 4.2
  - **구현 내용**:
    - 3×3 격자 버튼(9칸: top-left ~ bottom-right) 렌더링 및 현재 선택 하이라이트
    - 격자 버튼 클릭 시 `GRID_ANCHOR_PRESET_COORDINATES`에 따라 xPercent, yPercent, anchor 즉시 적용
    - 텍스트 박스 폭 슬라이더 (`widthPercent`: 20% ~ 90%)
    - '기본값으로 되돌리기' 버튼 클릭 시 `resetSongStyle` 호출하여 `DEFAULT_DECK_STYLE`로 복원
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 3×3 격자 클릭 시 좌표가 즉각 갱신된다.

- [ ] **Task 4.4: 우측 통합 곡 속성 패널(Property Panel) 컴포넌트 완성**
  - **대상 파일**: `apps/web/src/features/editor/SongPropertyPanel.tsx`
  - **선행 조건**: Task 4.1, Task 4.2, Task 4.3
  - **구현 내용**:
    - 상단: 현재 선택된 배경 썸네일 + '배경 바꾸기' 버튼 (`BackgroundPickerModal` 연동)
    - 중단: `TypographyControls` (오버레이 및 폰트/그림자/색상)
    - 하단: `PositionControls` (3×3 격자 위치 및 폭 조절)
    - 곡 미선택 시 안내 메시지 표시
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 3개 섹션의 모든 제어가 정상 렌더링된다.

---

### Phase M2-5: 세트 편집기 페이지 통합, 전체화면 송출 연동 & 최종 검증

- [ ] **Task 5.1: 세트 편집기 상단 헤더 바 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/EditorHeader.tsx`
  - **선행 조건**: Task 1.5
  - **구현 내용**:
    - 세트 제목 인라인 텍스트 편집 (예: '새 예배 콘티')
    - '새 곡 추가' 버튼 (클릭 시 `AddSongModal` 열기)
    - '전체화면 송출' 버튼 (클릭 시 현재 세트 데이터를 가지고 `/present/fullscreen`으로 이동)
    - '홈으로' 나가기 링크
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 버튼 클릭 시 올바른 이벤트 및 네비게이션이 실행된다.

- [ ] **Task 5.2: 전체화면 송출 라우트(`FullscreenPresentRoute`)의 세트 주입 연동**
  - **대상 파일**: `apps/web/src/routes/FullscreenPresentRoute.tsx`
  - **선행 조건**: Task 5.1
  - **구현 내용**:
    - React Router `useLocation().state?.setlist` 또는 `localStorage`의 편집된 세트 데이터를 우선 로드
    - 전달받은 세트 데이터가 없으면 기존 `mockSetlist`로 우아하게 폴백
    - 편집기에서 설정한 곡별 배경, 오버레이, 폰트, 텍스트 박스 위치가 전체화면에서 100% 동일하게 반영
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 편집기에서 구성한 세트가 전체화면으로 송출된다.

- [ ] **Task 5.3: 세트 편집기 전체 화면 라우트 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/routes/SetlistEditorRoute.tsx`
  - **선행 조건**: Task 2.2, Task 2.5, Task 3.3, Task 4.4, Task 5.1
  - **구현 내용**:
    - 3패널 레이아웃 구성:
      - 상단: `EditorHeader`
      - 좌측: `SongListPanel` (곡 목록 및 드래그 정렬)
      - 중앙 상단: `EditorStagePreview` (16:9 인터랙티브 조작 스테이지)
      - 중앙 하단: `SlideStripPanel` (슬라이드 썸네일 스트립)
      - 우측: `SongPropertyPanel` (곡별 속성 제어 패널)
    - `useSetlistEditor` 훅으로 전체 상태 바인딩 및 변경사항 실시간 반영
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 브라우저 렌더링 시 3패널 레이아웃이 완벽히 표시된다.

- [ ] **Task 5.4: 라우팅 등록 및 메인 홈 화면 세트 편집기 진입 카드 추가**
  - **대상 파일**: `apps/web/src/App.tsx`, `apps/web/src/routes/index.tsx`
  - **선행 조건**: Task 5.3
  - **구현 내용**:
    - `App.tsx`에 `/editor` 라우트 등록 (`SetlistEditorRoute`)
    - `index.tsx` 메인 홈 화면에 '세트 편집기 (15분 콘티 구성)' 카드 추가 및 `/editor` 링크 연결
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

## 3. 검증 명령어 요약

```bash
# 1. 텍스트 박스 오버플로우 감지 테스트
pnpm --filter @repo/shared vitest run src/utils/overflow.test.ts

# 2. 세트 편집기 상태 머신 테스트
pnpm --filter web vitest run src/features/editor/useSetlistEditor.test.ts

# 3. 슬라이드 수동 분할/합치기 테스트
pnpm --filter web vitest run src/features/editor/manualLyricSplit.test.ts

# 4. M2 편집기 통합 워크플로우 테스트
pnpm --filter web vitest run src/features/editor/editorWorkflow.test.tsx

# 5. 워크스페이스 전체 타입 및 린트 검사
pnpm typecheck && pnpm lint

# 6. 워크스페이스 전체 단위 및 통합 테스트 실행
pnpm test
```
