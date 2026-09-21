# Goal: [M2-2] 좌측 곡 목록 패널 및 가사 분할/합치기 모달

> **마일스톤**: M2 (편집기)  
> **태스크 번호**: `tasks_2.md`  
> **선행 조건**: `docs/tasks/m2/tasks_1.md` 완료  
> **목표**: `@dnd-kit`을 활용한 곡 목록 드래그 정렬 패널과, 슬라이드 수동 분할(커서 위치 나누기) 및 합치기 기능이 포함된 세트 곡 추가 모달을 구현한다.

> **구현 현황 (2026-09-21 재검토)**
>
> - Task 2.1은 `SortableList.tsx`, Task 2.2는 `EditorSidebar.tsx`(곡·슬라이드·가사·배경 4개 탭 드로어)로 구현되었다.
> - Task 2.5는 `AddSongModal.tsx` 대신 **`QuickLyricPasteModal.tsx`** 로 구현되었다(제목·아티스트 입력, `ExternalSearchLinks`, 실시간 분할 프리뷰, 세트 추가). 다만 프리뷰에서의 수동 나누기·합치기는 Task 2.4에 의존하므로 아직 없다.
> - **잔여: Task 2.3·2.4 (커서 위치 기준 슬라이드 나누기·합치기)** — PRD 4.2의 수동 편집 요건.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **가사 분할 규칙 준수**: 4줄 초과 시 자동 분할 및 사용자의 수동 분할/합치기 조작 시에도 공백 정규화 원칙(앞뒤 공백 제거, 불필요한 연속 빈 줄 배제)을 유지한다.
- **저작권 법적 안전성 준수**: 서비스가 가사를 자동 크롤링하지 않고 `ExternalSearchLinks`를 통해 멜론/벅스 검색 결과 페이지만 새 탭으로 연결한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 2.1: 드래그 앤 드롭 정렬 가능한 곡 리스트 아이템 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/SongListItem.tsx`
  - **선행 조건**: `docs/tasks/m2/tasks_1.md`
  - **구현 내용**:
    - `@dnd-kit/sortable`의 `useSortable` 훅 연동 (`transform`, `transition`, `listeners`, `attributes`)
    - 곡 번호(`1.`, `2.`), 곡 제목, 아티스트, 슬라이드 수 배지 렌더링
    - 오버플로우 발생 시 시각적 경고 아이콘(`⚠️`) 노출
    - 선택 활성화(Active) 하이라이트 스타일 및 곡 삭제(`onDelete`) 버튼 제공
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 곡 카드 렌더링 및 클릭/삭제 이벤트가 정상 동작한다.

- [x] **Task 2.2: 좌측 곡 목록 및 드래그 정렬 패널 컴포넌트 구현**
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
  - **선행 조건**: `docs/tasks/m2/tasks_1.md`
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

- [x] **Task 2.5: 세트 곡 추가 및 가사 편집 통합 모달 구현**
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

## 3. 검증 명령어

```bash
# 수동 분할/합치기 단위 테스트
pnpm --filter web vitest run src/features/editor/manualLyricSplit.test.ts

# 프론트엔드 타입 검사
pnpm --filter web typecheck
```
