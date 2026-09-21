# Goal: [M1-3] 인메모리 세트 및 가사 붙여넣기 모달

> **마일스톤**: M1 (송출 코어 엔진)  
> **태스크 번호**: `tasks_3.md`  
> **선행 조건**: `docs/tasks/m1/tasks_2.md` 완료  
> **목표**: M1 주일 예배 1회 실전 송출 검증을 위한 5곡 세트리스트 Mock 데이터와, 텍스트 붙여넣기 시 실시간으로 가사를 자동 분할해 주는 모달 UI 및 멜론/벅스 검색 링크를 구현한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **로그인 불필요 (Guest Presentation)**: M1 단계에서는 백엔드 인증 없이 메모리 및 로컬 상태만으로 5곡 세트를 구성하고 완주할 수 있어야 한다.
- **저작권 법적 안전성 준수**: 서비스가 직접 음원 사이트를 크롤링하지 않고 `target="_blank"` 외부 검색 결과 페이지 링크만 제공한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 3.1: M1 검증용 5곡 인메모리 세트리스트 Mock 데이터 작성**
  - **대상 파일**: `apps/web/src/features/presentation/mockSetlist.ts`
  - **선행 조건**: `docs/tasks/m1/tasks_2.md`
  - **구현 내용**:
    - 주일 예배 실전 송출 검증용 대표 5곡 찬양(예: 은혜로다, 주 품에, 시선, 꽃들도, 주의 이름 높이며) 덱 데이터 작성
    - 각 곡별 3~5개 슬라이드 분할 및 모션 배경 매핑
    - `@repo/shared`의 `SetlistSchema.parse`를 통한 스키마 정합성 사전 검증
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 Mock 세트 파싱이 에러 없이 완료된다.

- [x] **Task 3.2: 빠른 가사 붙여넣기 및 실시간 분할 모달 UI 구현**
  - **대상 파일**: `apps/web/src/features/editor/QuickLyricPasteModal.tsx`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - 텍스트 입력 에어리어(`textarea`)에 가사 붙여넣기 시 `splitLyricsIntoSlides`를 실시간 호출
    - 분할된 슬라이드 카드 목록과 줄 수(최대 4줄 제약) 실시간 미리보기 렌더링
    - '세트에 추가' 버튼 클릭 시 인메모리 덱 생성 및 세트에 삽입
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 텍스트 변경 시 슬라이드 분할 카드가 즉각 업데이트된다.

- [x] **Task 3.3: 멜론/벅스 가사 검색 새 탭 링크 컴포넌트 구현**
  - **대상 파일**: `apps/web/src/features/editor/ExternalSearchLinks.tsx`
  - **선행 조건**: Task 3.2
  - **구현 내용**:
    - 입력된 곡 제목을 인코딩하여 Melon / Bugs 가사 검색 URL 생성
    - `target="_blank" rel="noopener noreferrer"` 속성의 새 탭 열기 버튼 제공
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 버튼 클릭 시 올바른 멜론/벅스 검색 URL 링크가 생성된다.

---

## 3. 검증 명령어

```bash
# 프론트엔드 타입 검사
pnpm --filter web typecheck
```
