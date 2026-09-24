# Goal: [M2-3] 16:9 인터랙티브 스테이지 및 슬라이드 스트립

> **마일스톤**: M2 (편집기)  
> **태스크 번호**: `tasks_3.md`  
> **선행 조건**: `docs/tasks/m2/tasks_2.md` 완료  
> **목표**: `react-moveable`을 통한 16:9 텍스트 박스 실시간 드래그/폭 리사이즈 및 5% 안전 여백·중앙 스냅 가이드라인을 구현하고, 하단 슬라이드 스트립 패널을 완성한다.

> **구현 현황 (2026-09-21 재검토)**
>
> - 3개 태스크 모두 구현 완료: `TextBoxMoveable.tsx`, `EditorStageCanvas.tsx`, `SlideFilmstrip.tsx`.
> - **2026-09-24**: 하단 `SlideFilmstrip.tsx`는 삭제되었다. 슬라이드 탐색·추가·복제·삭제·정렬은 좌측 PPT식 `SlideThumbnailPane.tsx`가 맡고, 편집기의 슬라이드 번호는 세트 전체에서 1부터 이어진다(송출 번호와 동일).
> - 드래그·리사이즈 계산은 `textBoxDrag.ts`로 분리되어 단위 테스트가 있다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **5% 안전 여백 엄수**: 텍스트 박스는 화면 가장자리 5% 안쪽(`SAFE_MARGIN_PERCENT`: 5% ~ 95%)에서만 이동 가능하다.
- **중앙선 자석 스냅**: 드래그 이동 시 화면 가로(x=50%) 및 세로(y=50%) 중앙선에 접근하면 시각적 가이드라인을 표시하고 스냅한다.
- **앵커 사용자 지정 전환**: 미리보기 화면에서 텍스트 박스를 마우스로 직접 이동하거나 폭을 조절하면 `anchor`는 자동으로 `'custom'`으로 변경된다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 3.1: react-moveable 기반 텍스트 박스 조작 오버레이 컴포넌트 구현**
  - **대상 파일**: `src/client/features/editor/MoveableTextBox.tsx`
  - **선행 조건**: `docs/tasks/m2/tasks_2.md`
  - **구현 내용**:
    - 1920x1080 가상 스테이지 좌표계 내부에서 동작하는 `Moveable` 래퍼 컴포넌트
    - 드래그 이동(draggable): 5% 안전 여백(`SAFE_MARGIN_PERCENT`: 5% ~ 95%) 경계 제한
    - 좌우 폭 조절(resizable: left, right): 최소 20%, 최대 90% 제한
    - 드래그 또는 폭 조절 종료 시 `xPercent`, `yPercent`, `widthPercent` 계산 후 `updateSongStyle` 호출 (`anchor: 'custom'`)
    - 가로·세로 중앙선(50%) 스냅 가이드라인 실시간 감지 및 표시
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 텍스트 박스 드래그 및 폭 조절 시 퍼센트 좌표가 계산된다.

- [x] **Task 3.2: 16:9 편집 미리보기 인터랙티브 스테이지 컴포넌트 구현**
  - **대상 파일**: `src/client/features/editor/EditorStagePreview.tsx`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - 기존 `SlideStage` 위에 `MoveableTextBox` 및 중앙선 스냅 가이드라인 오버레이 렌더링
    - 최다 줄 슬라이드의 스테이지 이탈 경고 표시 (`checkSongStageOverflow` 연동)
    - 현재 선택된 슬라이드의 가사 및 곡 스타일(폰트, 크기, 오버레이, 그림자) 1:1 실시간 반영
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 스테이지 위에서 텍스트 조작 및 경고가 올바르게 렌더링된다.

- [x] **Task 3.3: 하단 슬라이드 썸네일 스트립 컴포넌트 구현**
  - **대상 파일**: `src/client/features/editor/SlideStripPanel.tsx`
  - **선행 조건**: Task 3.2
  - **구현 내용**:
    - 현재 활성 곡의 모든 슬라이드를 가로 스크롤 카드 스트립으로 표시
    - 슬라이드 번호(`1.1`, `1.2`, ...) 및 가사 텍스트 요약 렌더링
    - 슬라이드 카드 클릭 시 `selectSlide` 호출로 활성 슬라이드 전환
    - 슬라이드 추가(+) 및 삭제 버튼 제공
    - 개별 슬라이드의 글자 폭 초과 또는 줄 수 초과 시 경고 배지(`⚠️`) 표시
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 슬라이드 스트립 클릭 및 추가/삭제가 정상 동작한다.

---

## 3. 검증 명령어

```bash
# 프론트엔드 타입 검사
pnpm --filter web typecheck
```
