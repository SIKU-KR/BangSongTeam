# Goal: [M4-3] 송출 상태 추출 및 BroadcastChannel 동기화 계층

> **마일스톤**: M4 (오프라인 및 발표자 보기)
> **태스크 번호**: `tasks_3.md`
> **선행 조건**: `docs/tasks/m4/tasks_2.md` 완료 (예배 준비 화면)
> **목표**: 곡 경계를 넘나드는 송출 위치 계산을 순수 함수로 뽑고, 조작 창 ↔ 송출 창을 잇는 `worship-projection` 채널 계층을 만들어 기존 전체화면 라우트를 청중 창으로도 쓸 수 있게 한다
> **완료 기준 (DoD)**: `?audience=1`로 연 전체화면 창이 자체 키보드 입력 없이 BroadcastChannel 메시지만으로 슬라이드·블랙아웃·가사 숨기기를 따라간다

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **로직을 세 벌 만들지 않는다**: 다음/이전/점프 계산이 지금 `FullscreenPresentRoute` 안에 있다. 조작 창과 청중 창이 생기면 같은 로직이 세 벌이 된다. 순수 함수로 뽑아 한 곳에서만 고친다.
2. **단독 모드 동작은 1바이트도 바뀌지 않는다**: `?audience` 없이 연 `/present/:id/fullscreen`은 지금과 완전히 동일하게 동작해야 한다. 기존 `FullscreenPresentRoute.test.tsx`가 회귀 방지선이다.
3. **메시지는 반드시 검증한다**: 수신 메시지는 `BroadcastMessageSchema.safeParse`를 통과한 것만 반영한다. 실패하면 조용히 버린다. 다른 탭의 옛 버전이 보낸 메시지로 송출이 깨지면 안 된다.
4. **청중 창은 조작하지 않는다**: 청중 모드에서는 단축키·번호 버퍼를 걸지 않는다. 상태의 단일 원천은 조작 창이다.
5. **청중 창은 전체화면을 벗어나도 살아 있어야 한다**: 현재 라우트는 `fullscreenchange`로 전체화면이 풀리면 `/presentations`로 나가 버린다. 청중 모드에서는 이 동작을 끄고 '이 창을 프로젝터 화면으로 옮긴 뒤 클릭하면 전체화면이 됩니다' 안내를 대신 띄운다 (PRD §7.3).
6. **네트워크를 쓰지 않는다**: BroadcastChannel은 같은 PC 내부 통신이다 (PRD §6.2). 동기화 목적의 fetch를 추가하지 않는다.

---

## 2. 세부 작업 체크리스트

- [ ] **Task 3.1: 송출 위치 계산 순수 함수 (TDD)**
  - **대상 파일**: `apps/web/src/features/presentation/projectionState.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `nextPosition(position, songs)` — 곡 마지막 슬라이드면 다음 곡 첫 슬라이드로, 세트 끝이면 그대로
    - `prevPosition(position, songs)` — 곡 첫 슬라이드면 이전 곡 **마지막** 슬라이드로
    - `clampPosition(position, songs)` — 범위를 벗어난 인덱스를 안전한 값으로 (브로드캐스트로 들어온 값 방어)
    - `getSlideAt(position, songs)`, `getSongSlideCounts(songs)` 등 조회 헬퍼
    - `FullscreenPresentRoute`의 기존 동작과 100% 같은 결과를 내야 한다
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/features/presentation/projectionState.test.ts`가 100% 통과(Green)한다.

- [ ] **Task 3.2: BroadcastChannel 동기화 훅 (TDD)**
  - **대상 파일**: `apps/web/src/features/presentation/useProjectionChannel.ts`
  - **선행 조건**: `tasks_1.md` Task 1.2 (`PROJECTION_CHANNEL_NAME`)
  - **구현 내용**:
    - `useProjectionChannel({ onMessage })` — 채널 개설/해제, `post(message)` 반환
    - 수신 시 `BroadcastMessageSchema.safeParse` 통과분만 콜백에 넘긴다
    - `HEARTBEAT`를 주기 송신하고, 마지막 수신 시각으로 상대 창 연결 상태(`connected`/`disconnected`)를 계산해 노출
    - `BroadcastChannel`이 없는 환경에서도 throw하지 않고 no-op으로 동작
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/features/presentation/useProjectionChannel.test.ts`가 100% 통과(Green)한다.

- [ ] **Task 3.3: 전체화면 송출 라우트를 순수 함수 기반으로 리팩터링**
  - **대상 파일**: `apps/web/src/routes/FullscreenPresentRoute.tsx`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - `handleNext`/`handlePrev`/`handleJump`를 `projectionState` 함수 호출로 교체
    - 단독 모드의 외부 동작(키보드, 번호 점프, 블랙아웃, 가사 숨기기, 자동 종료)은 그대로 유지
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/routes/FullscreenPresentRoute.test.tsx`가 100% 통과(Green)한다.

- [ ] **Task 3.4: 청중 모드(`?audience=1`) 추가**
  - **대상 파일**: `apps/web/src/routes/FullscreenPresentRoute.tsx`
  - **선행 조건**: Task 3.2, 3.3
  - **구현 내용**:
    - `useSearchParams`로 청중 모드를 판별한다 (경로는 PRD 화면 목록대로 `/present/:id/fullscreen` 하나를 유지)
    - 청중 모드: 마운트 시 `AUDIENCE_MOUNTED` 송신 → `SYNC_SNAPSHOT` 수신으로 위치·블랙아웃·가사 상태 복원
    - 이후 `NAVIGATE_SLIDE`·`SET_BLACKOUT`·`SET_LYRICS_HIDDEN`을 반영한다. 들어온 인덱스는 `clampPosition`으로 방어한다
    - 청중 모드에서는 단축키·번호 버퍼를 걸지 않고, `fullscreenchange` 자동 종료를 끈다
    - 전체화면이 아닐 때만 '프로젝터 화면으로 옮긴 뒤 클릭' 안내 오버레이를 띄우고, 클릭하면 전체화면으로 들어간다
    - 송출 종료 버튼은 청중 모드에서 `window.close()` (PRD: 종료는 발표자 보기의 종료 버튼으로)
  - **DoD (통과 기준)**: `pnpm exec vitest run apps/web/src/routes/FullscreenPresentRoute.audience.test.tsx`가 100% 통과(Green)한다.

---

## 3. 검증 명령어

```bash
pnpm exec vitest run apps/web/src/features/presentation apps/web/src/routes
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_4.md`(M4-4)에서 이 채널의 반대편인 조작 창(발표자 보기)을 만든다.
