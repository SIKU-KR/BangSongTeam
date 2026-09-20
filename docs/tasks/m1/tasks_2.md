# Goal: [M1-2] 송출 상태 머신 및 숫자 키패드 네비게이션 버퍼

> **마일스톤**: M1 (송출 코어 엔진)  
> **태스크 번호**: `tasks_2.md`  
> **선행 조건**: `docs/tasks/m1/tasks_1.md` 완료  
> **목표**: 100ms 이내 반응성을 보장하는 키보드/프레젠터 리모컨 단축키와 USB 숫자 키패드용 점프 버퍼 엔진(`N`, `N.`, `N.M`)을 TDD로 구현한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **송출 지연 100ms 이내**: 슬라이드 전환 키 입력 즉시 화면 상태가 반영되어야 하며, 불필요한 비동기 작업이나 리렌더링을 차단한다.
- **청중 화면 오염 금지 (Clean Audience)**: 전체화면 송출 시에는 숫자 입력 버퍼(`4.2_`)나 유효하지 않은 인덱스 경고를 청중 화면에 절대 띄우지 않는다.

---

## 2. 세부 작업 체크리스트

- [ ] **Task 2.1: 숫자 키패드 입력 버퍼 상태 머신 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `apps/web/src/features/presentation/navigationBuffer.test.ts`
  - **선행 조건**: `docs/tasks/m1/tasks_1.md`
  - **구현 내용**:
    - 테스트 케이스 1: `3` + Enter $\rightarrow$ 현재 곡의 3번째 슬라이드(`slideIndex: 2`) 점프 콜백 발생
    - 테스트 케이스 2: `2.` + Enter $\rightarrow$ 2번째 곡의 1번째 슬라이드(`songIndex: 1, slideIndex: 0`) 점프 콜백 발생
    - 테스트 케이스 3: `2.4` + Enter $\rightarrow$ 2번째 곡의 4번째 슬라이드(`songIndex: 1, slideIndex: 3`) 점프 콜백 발생
    - 테스트 케이스 4: Backspace 입력 시 버퍼 마지막 글자 제거
    - 테스트 케이스 5: 3초(3000ms) 무입력 시 버퍼 자동 클리어 (fake timers 검증)
    - 테스트 케이스 6: 인덱스 초과 등 유효하지 않은 입력 시 점프 콜백 미발생 및 버퍼 클리어
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/presentation/navigationBuffer.test.ts` 실행 시 구현체가 없어 실패(Red)함을 확인한다.

- [ ] **Task 2.2: 숫자 키패드 입력 버퍼 훅 구현 (TDD Green)**
  - **대상 파일**: `apps/web/src/features/presentation/useNavigationBuffer.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `buffer` 문자열 상태 관리 및 3초 타이머(`useRef<NodeJS.Timeout>`) 관리
    - `handleKey(key: string)`: 숫자(`0~9`), `.`, `Backspace`, `Enter` 처리
    - `onJump: (songIndex: number, slideIndex: number) => void` 콜백 호출
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/features/presentation/navigationBuffer.test.ts`가 100% 통과(Green)한다.

- [ ] **Task 2.3: 송출 키보드 및 리모컨 단축키 이벤트 훅 구현**
  - **대상 파일**: `apps/web/src/features/presentation/usePresentationShortcuts.ts`
  - **선행 조건**: Task 2.2
  - **구현 내용**:
    - `tinykeys` 라이브러리 연동:
      - `ArrowRight`, `Space`, `PageDown` $\rightarrow$ 다음 슬라이드 (`onNext`)
      - `ArrowLeft`, `PageUp` $\rightarrow$ 이전 슬라이드 (`onPrev`)
      - `'b'`, `'B'` $\rightarrow$ 블랙아웃 토글 (`onToggleBlackout`)
      - `'h'`, `'H'` $\rightarrow$ 가사 숨김 토글 (`onToggleLyrics`)
    - 숫자 키 및 `.` 입력 시 `useNavigationBuffer`의 `handleKey`로 이벤트 위임
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 키보드 이벤트에 따라 각 콜백이 올바르게 실행된다.

---

## 3. 검증 명령어

```bash
# 네비게이션 버퍼 단위 테스트 실행
pnpm --filter web vitest run src/features/presentation/navigationBuffer.test.ts

# 프론트엔드 타입 검사
pnpm --filter web typecheck
```
