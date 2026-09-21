# Goal: [M2-4] 곡 속성 패널 및 모션 배경 라이브러리 모달

> **마일스톤**: M2 (편집기)  
> **태스크 번호**: `tasks_4.md`  
> **선행 조건**: `docs/tasks/m2/tasks_3.md` 완료  
> **목표**: 호버 영상 미리보기를 지원하는 사전 주입 배경 모달과, 검정 오버레이·타이포그래피·색상 피커·3×3 격자 위치 프리셋을 조작하는 우측 통합 곡 속성 패널을 구현한다.

> **구현 현황 (2026-09-21 재검토)**
>
> - 4개 태스크 모두 구현 완료: `BackgroundPickerModal.tsx`, `ColorPickerField.tsx`, 그리고 타이포·그림자·3×3 앵커·폭 컨트롤을 모두 담은 `SongPropertyPanel.tsx`.
> - 속성 패널에 넘침 경고 표시만 비어 있다 (`tasks_1.md`의 Task 1.2·1.3 완료 후 연결).
> - 배경 목록은 아직 `/api/backgrounds`가 아니라 `@repo/shared`의 `INITIAL_BACKGROUNDS` 상수를 읽는다 (TECH_SPEC §7.1 각주).

---

## 1. 아키텍처 가드레일 & 준수 사항

- **곡 단위 스타일 격리**: 모든 가독성 설정(오버레이, 폰트, 크기, 그림자, 위치)은 곡(Deck) 단위로 독립 저장되며 한 곡의 모든 슬라이드가 스타일을 공유한다.
- **오프라인 번들 폰트 준수**: 폰트 선택 목록은 번들 폰트(Pretendard, Noto Sans KR, Nanum Myeongjo, Gmarket Sans, KoPubWorld Batang)로 제한한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 4.1: 사전 주입 루프 배경 영상 선택 모달 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/BackgroundPickerModal.tsx`
  - **선행 조건**: `docs/tasks/m2/tasks_3.md`
  - **구현 내용**:
    - M0에서 사전 주입된 배경 영상 10종(R2 비디오 URL 및 포스터) 그리드 렌더링
    - 태그 필터 탭 (전체, 차분한, 밝은, 웅장한, 자연 등)
    - 카드 호버 시 `<video>` 자동 재생 미리보기, 마우스 이탈 시 일시 정지
    - 배경 클릭 선택 시 `updateSongBackground` 호출 및 모달 닫기
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 호버 재생 및 배경 선택 콜백이 정상 작동한다.

- [x] **Task 4.2: 타이포그래피 및 가독성 오버레이 컨트롤 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/TypographyControls.tsx`
  - **선행 조건**: Task 4.1
  - **구현 내용**:
    - 검정 오버레이 불투명도 슬라이더 (0% ~ 100%, 1% 단위 숫자 표시)
    - 폰트 셀렉트 (Pretendard, Noto Sans KR, Nanum Myeongjo, Gmarket Sans, KoPubWorld Batang)
    - 글자 크기 슬라이더 (`fontSizeVw`: 2.0 ~ 10.0, 0.1vw 단위)
    - 텍스트 정렬 버튼 그룹 (좌, 중, 우)
    - 텍스트 그림자 4단계 세그먼트 버튼 (`none`, `soft`, `medium`, `strong`)
    - 텍스트 색상 선택: `react-colorful` 팝오버 및 프리셋 색상 스와치 버튼
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 각 컨트롤 값 변경 시 `updateSongStyle`이 호출된다.

- [x] **Task 4.3: 3×3 격자 앵커 프리셋 및 폭 조절 컨트롤 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/PositionControls.tsx`
  - **선행 조건**: Task 4.2
  - **구현 내용**:
    - 3×3 격자 버튼(9칸: top-left ~ bottom-right) 렌더링 및 현재 선택 하이라이트
    - 격자 버튼 클릭 시 `GRID_ANCHOR_PRESET_COORDINATES`에 따라 xPercent, yPercent, anchor 즉시 적용
    - 텍스트 박스 폭 슬라이더 (`widthPercent`: 20% ~ 90%)
    - '기본값으로 되돌리기' 버튼 클릭 시 `resetSongStyle` 호출하여 `DEFAULT_DECK_STYLE`로 복원
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 3×3 격자 클릭 시 좌표가 즉각 갱신된다.

- [x] **Task 4.4: 우측 통합 곡 속성 패널(Property Panel) 컴포넌트 완성**
  - **대상 파일**: `apps/web/src/features/editor/SongPropertyPanel.tsx`
  - **선행 조건**: Task 4.1, Task 4.2, Task 4.3
  - **구현 내용**:
    - 상단: 현재 선택된 배경 썸네일 + '배경 바꾸기' 버튼 (`BackgroundPickerModal` 연동)
    - 중단: `TypographyControls` (오버레이 및 폰트/그림자/색상)
    - 하단: `PositionControls` (3×3 격자 위치 및 폭 조절)
    - 곡 미선택 시 안내 메시지 표시
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 3개 섹션의 모든 제어가 정상 렌더링된다.

---

## 3. 검증 명령어

```bash
# 프론트엔드 타입 검사
pnpm --filter web typecheck
```
