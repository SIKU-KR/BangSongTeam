# Goal: [M4-4] 발표자 보기 조작 창 (Presenter Control Window)

> **2026-09-24 범위 변경**: 이 태스크의 산출물은 **전부 제거됐다**. 발표자 보기(조작 창·청중 창·BroadcastChannel 동기화·Window Management 배치)는 MVP에서 빠졌고, 송출은 전체화면 `/present/:id/fullscreen` 한 가지다. 이 문서는 이력으로만 남긴다.

> **마일스톤**: M4 (오프라인 및 발표자 보기)
> **태스크 번호**: `tasks_4.md`
> **선행 조건**: `docs/tasks/m4/tasks_3.md` 완료 (BroadcastChannel 계층, 청중 모드)
> **목표**: 현재·다음 슬라이드, 곡 점프, 블랙아웃·가사 숨기기, 타이머를 갖춘 조작 창을 만들고, Window Management API로 보조 모니터에 청중 창을 띄운다
> **완료 기준 (DoD)**: 조작 창에서 슬라이드를 넘기면 별도 창의 청중 화면이 즉시 따라오고, 보조 모니터가 있으면 그 화면 위치로 창이 열린다

> **구현 현황 (2026-09-22)**
>
> - Task 4.1~4.6 완료. 전체 **670개 / 87파일 Green**.
> - **죽은 코드 `checkScreenDetails()`를 제거했다.** 권한이 이미 granted일 때만 화면을 읽어 호출부가 하나도 없었고, 그래서 `enterFullscreen`의 `screen` 옵션 분기도 영원히 닿지 않는 코드였다. `openAudienceWindow()`가 `getScreenDetails()`를 직접 불러 권한을 요청한다.
> - **타이머 정의**: PRD에 '타이머' 한 줄만 있어 **경과 시간(mm:ss) + 현재 시각(HH:MM)** 으로 정했다. 경과는 멈춤·리셋이 되고, 현재 시각은 항상 흐른다.
> - `PresenterControlBar`는 상태를 갖지 않는 표시 전용이라 단독 테스트 대신 라우트 통합 테스트로 덮었다. DoD를 그에 맞게 고쳤다.
> - jsdom에 `scrollIntoView`가 없어 점프 패널의 자동 스크롤을 옵셔널 호출로 바꿨다. 없다고 조작 창이 죽으면 안 된다.
> - **보조 모니터 실검증은 남아 있다.** 이 환경에는 디스플레이가 하나도 없어 폴백 경로만 확인된다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **조작 창이 상태의 단일 원천이다**: 청중 창은 받은 대로만 그린다. 양방향 편집을 만들지 않는다.
2. **3-Layer 스테이지를 재사용한다**: 조작 창의 현재·다음 미리보기도 `SlideStage`를 그대로 쓴다. 캔버스나 다른 렌더러로 대체하지 않는다 (AGENTS.md §6).
3. **청중 화면에는 조작 흔적이 없다**: 입력 중인 번호(`4.2_`)와 '없는 번호' 토스트는 **조작 창에만** 띄운다 (PRD §5, TECH_SPEC §5.2).
4. **송출 종료는 버튼으로만**: PRD §5 — "송출 종료는 단축키 없이 발표자 보기의 종료 버튼으로만 한다". 종료 시 청중 창도 함께 닫는다.
5. **권한 거부가 막다른 길이 되면 안 된다**: Window Management 권한을 거부하거나 모니터가 하나면 일반 팝업으로 열고 안내 문구로 대체한다 (PRD §7.3).
6. **팝업 차단을 구분해 보고한다**: `window.open`이 `null`을 돌려주면 사용자에게 팝업 허용을 안내한다. 조용히 실패하면 조작자는 청중 창이 왜 안 뜨는지 알 수 없다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 4.1: 청중 창 오프너 및 Window Management 연동 (TDD)**
  - **대상 파일**: `apps/web/src/features/presentation/audienceWindow.ts`
  - **선행 조건**: `tasks_3.md` Task 3.4
  - **구현 내용**:
    - `openAudienceWindow(presentationId)` — `/present/:id/fullscreen?audience=1`을 `"WorshipAudienceWindow"` 이름으로 연다
    - `getScreenDetails()`를 **실제로 호출해 권한을 요청**한다. 기존 `fullscreen.ts`의 `checkScreenDetails()`는 이미 granted일 때만 읽어 호출부가 없는 죽은 코드였다 — 이것으로 대체하고 죽은 코드를 제거한다
    - `currentScreen`이 아닌 화면을 찾으면 `left/top/width/height`로 그 모니터에 띄운다
    - 결과를 `{ status: "secondary" | "fallback" | "blocked" | "unsupported", window, message }`로 돌려준다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/features/presentation/audienceWindow.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.2: 송출 경과 타이머 훅 (TDD)**
  - **대상 파일**: `apps/web/src/features/presentation/useElapsedTimer.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - PRD에 '타이머' 한 줄만 있고 세부 명세가 없으므로 **송출 경과 시간(mm:ss) + 현재 시각**으로 정의한다
    - `start`/`pause`/`reset` 제공, 1초 간격 갱신, 언마운트 시 타이머 정리
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/features/presentation/useElapsedTimer.test.ts`가 100% 통과(Green)한다.

- [x] **Task 4.3: 현재·다음 슬라이드 미리보기 패널**
  - **대상 파일**: `apps/web/src/features/presentation/PresenterPreviewPanel.tsx`
  - **선행 조건**: `tasks_3.md` Task 3.1
  - **구현 내용**:
    - '현재'는 크게, '다음'은 작게. 둘 다 `SlideStage`에 `containerDimensions`를 주어 렌더
    - 다음이 다음 곡의 첫 슬라이드면 곡 제목을 함께 표시한다
    - 세트 마지막이면 '마지막 슬라이드' 표시
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/features/presentation/PresenterPreviewPanel.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 4.4: 곡·슬라이드 점프 패널**
  - **대상 파일**: `apps/web/src/features/presentation/PresenterJumpPanel.tsx`
  - **선행 조건**: Task 4.3
  - **구현 내용**:
    - 곡 목록에 번호(`1.`, `2.`)와 슬라이드 썸네일 번호를 표시한다 (PRD §5: 곡 목록과 슬라이드 썸네일에 번호 표시)
    - 클릭하면 해당 위치로 점프. 현재 위치 하이라이트
    - 세트가 길어도 현재 곡이 보이도록 스크롤을 따라가게 한다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/features/presentation/PresenterJumpPanel.test.tsx`가 100% 통과(Green)한다.

- [x] **Task 4.5: 조작 바 (블랙아웃·가사 숨기기·타이머·창 제어)**
  - **대상 파일**: `apps/web/src/features/presentation/PresenterControlBar.tsx`
  - **선행 조건**: Task 4.1, 4.2
  - **구현 내용**:
    - 블랙아웃(B)·가사 숨기기(H) 토글 버튼, 활성 상태를 눈에 띄게 표시
    - 경과 시간·현재 시각, 청중 창 연결 상태 배지
    - 「송출 창 열기」/「다시 연결」, 「송출 종료」 버튼
    - 입력 중인 번호(`4.2_`)와 '없는 번호' 2초 토스트
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/routes/PresenterControlRoute.test.tsx`의 블랙아웃·버퍼·연결 상태 케이스가 100% 통과(Green)한다.

- [x] **Task 4.6: 발표자 보기 라우트 결합**
  - **대상 파일**: `apps/web/src/routes/PresenterControlRoute.tsx`, `apps/web/src/App.tsx`
  - **선행 조건**: Task 4.3~4.5
  - **구현 내용**:
    - 경로 `/present/:presentationId/control` (PRD §5 화면 목록 기준)
    - `projectionState`로 위치를 관리하고, 변경마다 `NAVIGATE_SLIDE`·`SET_BLACKOUT`·`SET_LYRICS_HIDDEN`을 송신
    - `AUDIENCE_MOUNTED` 수신 시 즉시 `SYNC_SNAPSHOT` 회신 (TECH_SPEC §5.3 핸드셰이크)
    - `usePresentationShortcuts` + `useNavigationBuffer`를 조작 창에 건다. `onInvalidJump`로 토스트를 띄운다 (지금까지 아무도 쓰지 않던 인자다)
    - 「송출 종료」는 청중 창을 닫고 `/presentations`로 돌아간다. Esc는 종료하지 않는다
    - `App.tsx`·`routes/index.ts`에 라우트 등록
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/routes/PresenterControlRoute.test.tsx`가 100% 통과(Green)한다.

---

## 3. 검증 명령어

```bash
pnpm exec vitest run apps/web/src/features/presentation apps/web/src/routes
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_5.md`(M4-5)에서 Zero-Fetch 불변식을 테스트로 고정하고, 코드와 어긋난 문서를 정정한 뒤 운영자 실검증 절차를 남긴다.
