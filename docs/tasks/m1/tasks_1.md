# Goal: [M1-1] 프론트엔드 기반 및 3-Layer Slide Stage

> **마일스톤**: M1 (송출 코어 엔진)  
> **태스크 번호**: `tasks_1.md`  
> **선행 조건**: `docs/tasks/m0/tasks_4.md` 완료  
> **목표**: 16:9 고정 가상 스테이지(1920x1080) 위에서 동작하는 무결점 3-Layer 렌더링 엔진(Video A/B 교차 루프, Black Overlay, Typography Stage)과 오프라인 로컬 웹폰트 번들을 구축한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **3-Layer DOM 구조 불변성**: 슬라이드는 캔버스나 무거운 프레임워크(Reveal.js) 대신 DOM 3-Layer 구조(Layer 1: Video, Layer 2: Overlay, Layer 3: Typography)로 구현하며 16:9 컨테이너 내에서 CSS `transform: scale(s)`로만 반응형 크기를 조정한다.
- **검은 화면(Black Flicker) 0% 보장**: 동일 곡에서는 `<video>`가 끊김 없이 루프하고, 곡 전환 시에는 2개의 교차 비디오 태그와 0.2s 크로스페이드로 전환하여 검은 화면을 원천 방지한다.
- **오프라인 폰트 보장**: 폰트는 npm 번들(Pretendard)로만 제공하며 외부 Google Fonts 등 CDN 요청을 완전히 배제한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 1.1: Vite SPA 프론트엔드 빌드 및 Tailwind CSS 구성**
  - **대상 파일**: `vite.config.ts`, `apps/web/index.html`, `apps/web/tailwind.config.js`
  - **선행 조건**: `docs/tasks/m0/tasks_4.md`
  - **구현 내용**:
    - `@cloudflare/vite-plugin`, `@vitejs/plugin-react` 플러그인 설정
    - Tailwind CSS 유틸리티 및 16:9 스테이지 캔버스 CSS 테마 설정
  - **DoD (통과 기준)**: `pnpm --filter web build` 실행 시 번들링 에러 없이 `dist/` 빌드가 완료된다.

- [x] **Task 1.2: Pretendard 로컬 웹폰트 번들링 및 글로벌 스타일 구성**
  - **대상 파일**: `src/client/index.css`, `src/client/main.tsx`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - `pretendard` npm 패키지 설치 및 로컬 CSS import
    - 외부 CDN 폰트 호출 완전 배제
    - 안티앨리어싱 및 텍스트 렌더링 최적화 속성(`-webkit-font-smoothing: antialiased`) 설정
  - **DoD (통과 기준)**: 브라우저 로드 시 네트워크 탭에 외부 폰트 요청 없이 Pretendard가 즉각 렌더링된다.

- [x] **Task 1.3: 비-Chrome 브라우저 접속 감지 및 경고 배너 컴포넌트 구현**
  - **대상 파일**: `src/client/components/common/ChromeAlertBanner.tsx`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - User-Agent Client Hints(`navigator.userAgentData?.brands`)로 'Google Chrome' 여부 판별
    - Edge, Whale, Safari 등 접속 시 상단 비차단 안내 배너 렌더링
    - 배너 닫기 클릭 시 `localStorage`에 상태를 저장하여 재노출 방지
  - **DoD (통과 기준)**: 비-Chrome 에이전트 Mock 테스트 시 배너가 표시되고 닫기 동작이 정상 작동한다.

- [x] **Task 1.4: 16:9 가상 스테이지 반응형 스케일러 훅 구현 및 테스트**
  - **대상 파일**: `src/client/hooks/useStageScale.ts`, `src/client/hooks/useStageScale.test.ts`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - 1920x1080 해상도를 브라우저 화면에 맞춰 비율 왜곡 없이 CSS `scale`, `translateX`, `translateY`를 계산하는 훅
    - 리사이즈 이벤트 쓰로틀링 적용
    - 단위 테스트: 1280x720, 1920x1080, 2560x1440 등 다양한 해상도에서 올바른 scale 계산 검증
  - **DoD (통과 기준)**: `pnpm --filter web vitest run src/hooks/useStageScale.test.ts`가 100% 통과한다.

- [x] **Task 1.5: 3-Layer Stage Layer 3 - Typography & Text Box 컴포넌트 구현**
  - **대상 파일**: `src/client/components/stage/TextLayer.tsx`
  - **선행 조건**: Task 1.4
  - **구현 내용**:
    - 위치 계산: `left: ${pos.xPercent}%`, `top: ${pos.yPercent}%`, `width: ${pos.widthPercent}%`
    - 앵커 성장 규칙:
      - `bottom-*`: `translate(-50%, -100%)` (위로 성장)
      - `middle-*`: `translate(-50%, -50%)` (상하 대칭 성장)
      - `top-*`: `translate(-50%, 0)` (아래로 성장)
    - 4단계 텍스트 그림자(`none`, `soft`, `medium`, `strong`) 인라인 CSS 적용
    - `isLyricsHidden` 활성화 시 텍스트 레이어 opacity 0 처리
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 앵커별 DOM transform 스타일이 정확히 적용된다.

- [x] **Task 1.6: 3-Layer Stage Layer 2 - Black Overlay 컴포넌트 구현**
  - **대상 파일**: `src/client/components/stage/OverlayLayer.tsx`
  - **선행 조건**: Task 1.4
  - **구현 내용**:
    - 순수 CSS 검정 오버레이: `background-color: #000000; opacity: ${opacity / 100};`
    - 60fps GPU 합성을 위한 `will-change: opacity` 적용
    - `isBlackout` 활성화 시 즉시 `opacity: 1`을 강제하여 무대 전체 암전
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 blackout prop 변경 시 전체가 암전된다.

- [x] **Task 1.7: 3-Layer Stage Layer 1 - 무결점 전환 Dual Video A/B 교차 루프 컴포넌트 구현**
  - **대상 파일**: `src/client/components/stage/VideoLayer.tsx`
  - **선행 조건**: Task 1.4
  - **구현 내용**:
    - 2개의 `<video autoplay muted loop playsinline>` 태그(`Video-A`, `Video-B`)를 겹쳐 배치
    - 동일 곡 내 슬라이드 이동 시 비디오는 리셋 없이 무한 루프 유지
    - 다음 곡 비디오 사전 로드(`preload="auto"`) 및 곡 전환 시 0.2s 크로스페이드 트랜지션 실행
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 비디오 소스 교체 시 크로스페이드 상태 머신이 정상 동작한다.

- [x] **Task 1.8: 3-Layer SlideStage 통합 컴포넌트 완성**
  - **대상 파일**: `src/client/components/stage/SlideStage.tsx`
  - **선행 조건**: Task 1.5, Task 1.6, Task 1.7
  - **구현 내용**:
    - 1920x1080 가상 스테이지 컨테이너에 `VideoLayer`, `OverlayLayer`, `TextLayer`를 z-index 순서로 배치
    - `useStageScale`을 통한 CSS `transform: scale(...)` 스케일링 컨테이너 래핑
    - props: `slide`, `style`, `backgroundUrl`, `nextBackgroundUrl`, `isBlackout`, `isLyricsHidden`
  - **DoD (통과 기준)**: `pnpm --filter web exec tsc --noEmit`이 통과하고 슬라이드 전환 시 100ms 이내에 텍스트만 즉각 교체된다.

---

## 3. 검증 명령어

```bash
# 프론트엔드 타입 검사
pnpm --filter web typecheck

# 스테이지 스케일러 단위 테스트
pnpm --filter web vitest run src/hooks/useStageScale.test.ts
```
