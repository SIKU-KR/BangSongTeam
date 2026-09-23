# Goal: [M0-2] 도메인 모델 및 Zod 스키마 (packages/shared)

> **2026-09-23 범위 변경**: LLM 가사 정규화와 가사 라이브러리(카탈로그·가사 기여·대표 가사·곡 식별)는 MVP에서 제거됐다 (`packages/db/drizzle/0005_remove_catalog.sql`). 공유 라이브러리는 같은 곡을 여러 사람이 따로 공개하는 게시판(가져간 횟수순)만 남는다. 이 문서의 해당 부분은 이력으로 남긴다.

> **마일스톤**: M0 (인프라 및 기반 구성)  
> **태스크 번호**: `tasks_2.md`  
> **선행 조건**: `docs/tasks/m0/tasks_1.md` 완료  
> **목표**: 프론트엔드와 백엔드가 공유할 단일 진실 공급원(Single Source of Truth)인 Zod 도메인 스키마와 공통 가사 분할 알고리즘을 TDD로 작성한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **타입 단일 원천**: 모든 타입은 `z.infer<typeof Schema>`로만 추론하며 별도 TypeScript `interface`의 중복 수동 선언을 금지한다.
- **순수 라이브러리 격리**: `packages/shared`는 브라우저(`window`, `document`) 및 Node/Worker 특정 API를 포함하지 않는 순수 TypeScript 패키지여야 한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 2.1: packages/shared 패키지 골격 및 tsconfig 설정**
  - **대상 파일**: `packages/shared/package.json`, `packages/shared/tsconfig.json`
  - **선행 조건**: `docs/tasks/m0/tasks_1.md`
  - **구현 내용**:
    - 패키지명 `@repo/shared` 선언, `zod`, `vitest` 의존성 구성
    - `tsconfig.json`에서 `@repo/typescript-config/tsconfig.base.json` 상속
    - `package.json`의 `exports`에 `.` 및 서브경로 매핑 선언
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 2.2: 스타일 및 텍스트 박스 위치 Zod 스키마 정의**
  - **대상 파일**: `packages/shared/src/schemas/style.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `GridAnchorPresetSchema`: 9칸 격자('top-left' ~ 'bottom-right') + 'custom'
    - `TextBoxPositionSchema`: `anchor`, `xPercent(5~95)`, `yPercent(5~95)`, `widthPercent(20~90)`
    - `DeckStyleSchema`: `overlayOpacity(0~100)`, `overlayColor`, `fontFamily`, `fontSizeVw(2~10)`, `fontColor`, `textAlign`, `lineHeight`, `textShadowLevel`, `position`
    - `GridAnchorPreset`, `TextBoxPosition`, `DeckStyle` 타입 export
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared exec tsc --noEmit`이 성공하고 `DeckStyleSchema.parse({})`가 TECH_SPEC에 정의된 기본값을 정확히 반환한다.

- [x] **Task 2.3: 슬라이드 스키마 정의 및 단위 테스트 작성**
  - **대상 파일**: `packages/shared/src/schemas/slide.ts`, `packages/shared/src/schemas/slide.test.ts`
  - **선행 조건**: Task 2.2
  - **구현 내용**:
    - `SlideSchema`: `id(기본값 s_xxx)`, `order(int >= 0)`, `lines(z.array(z.string().max(80)).max(4))` 슬라이드당 최대 4줄 제약
    - `slide.test.ts`: 4줄 초과 시 파싱 거부 검증 및 기본 난수 ID 포맷 검증
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared vitest run src/schemas/slide.test.ts`가 100% 통과한다.

- [x] **Task 2.4: 덱(Deck) 도메인 스키마 정의 (Clone-on-Add 스코프 반영)**
  - **대상 파일**: `packages/shared/src/schemas/deck.ts`
  - **선행 조건**: Task 2.3
  - **구현 내용**:
    - `DeckScopeSchema`: `'library' | 'presentation'`
    - `DeckVisibilitySchema`: `'private' | 'public'`
    - `DeckSchema`: `id`, `userId`, `catalogId`, `scope`, `presentationId`, `title`, `artist`, `lyricsRaw`, `slides(SlideSchema.array())`, `backgroundId`, `style(DeckStyleSchema)`, `visibility`, `forkedFrom`, `forkCount`, 타임스탬프
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 2.5: 프레젠테이션(Presentation) 도메인 스키마 정의**
  - **대상 파일**: `packages/shared/src/schemas/presentation.ts`
  - **선행 조건**: Task 2.4
  - **구현 내용**:
    - `PresentationItemSchema`: `id`, `presentationId`, `deckId`, `order`, `deck(DeckSchema.optional())`
    - `PresentationSchema`: `id`, `userId`, `title`, `serviceDate(/^\d{4}-\d{2}-\d{2}$/)`, `items(PresentationItemSchema.array())`
  - **DoD (통과 기준)**: YYYY-MM-DD 정규식 유효성 및 PresentationItem 배열 파싱 검증이 정상 통과한다.

- [x] **Task 2.6: 배경 미디어 및 가사 카탈로그 스키마 정의**
  - **대상 파일**: `packages/shared/src/schemas/media.ts`, `packages/shared/src/schemas/catalog.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `BackgroundMediaSchema`: `id`, `title`, `r2Key`, `posterKey`, `durationSec`, `license`, `tags`, `cdnUrl`, `posterUrl`
    - `CatalogStatusSchema`: `'single' | 'normalized' | 'locked'`
    - `LyricCatalogSchema`: `id`, `title`, `artist`, `titleNorm`, `artistNorm`, `lyricsCanonical`, `versionCount`, `status`
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 2.7: BroadcastChannel 동기화 메시지 스키마 및 단위 테스트 작성**
  - **대상 파일**: `packages/shared/src/schemas/broadcast.ts`, `packages/shared/src/schemas/broadcast.test.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `BroadcastMessageSchema`: 6가지 Discriminated Union(`AUDIENCE_MOUNTED`, `SYNC_SNAPSHOT`, `NAVIGATE_SLIDE`, `SET_BLACKOUT`, `SET_LYRICS_HIDDEN`, `HEARTBEAT`)
    - 단위 테스트: 각 메시지 타입별 유효 페이로드 및 잘못된 타입 수신 시 거부 검증
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared vitest run src/schemas/broadcast.test.ts`가 100% 통과한다.

- [x] **Task 2.8: API 요청/응답 페이로드 스키마 정의**
  - **대상 파일**: `packages/shared/src/schemas/api.ts`
  - **선행 조건**: Task 2.4, Task 2.5, Task 2.6
  - **구현 내용**:
    - `CreateDeckRequestSchema`, `UpdateDeckRequestSchema`
    - `CreatePresentationRequestSchema`, `UpdatePresentationItemsRequestSchema`
    - `SearchCatalogQuerySchema`, `SearchCatalogResponseSchema`
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 2.9: 가사 정제 및 슬라이드 분할 규칙 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `packages/shared/src/utils/lyrics.test.ts`
  - **선행 조건**: Task 2.3
  - **구현 내용**:
    - 테스트: 앞뒤/전각 공백 제거, 빈 줄 병합, 4줄 이하 유지, 4줄 초과 시 2줄 단위 분할, 슬라이드 순서 보존 검증
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared vitest run src/utils/lyrics.test.ts` 실행 시 구현체가 없어 실패(Red)함을 확인한다.

- [x] **Task 2.10: 가사 정제 및 슬라이드 분할 유틸리티 구현 (TDD Green)**
  - **대상 파일**: `packages/shared/src/utils/lyrics.ts`
  - **선행 조건**: Task 2.9
  - **구현 내용**:
    - `sanitizeLyricLine(line: string): string`
    - `splitLyricsIntoSlides(rawText: string): Slide[]` (PRD 4.2 슬라이드 분할 규칙 완벽 구현)
    - `mergeSlidesToLyrics(slides: Slide[]): string`
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared vitest run src/utils/lyrics.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.11: 공유 상수 선언 및 메인 배럴 엔트리포인트 완성**
  - **대상 파일**: `packages/shared/src/constants/index.ts`, `packages/shared/src/index.ts`
  - **선행 조건**: Task 2.2 ~ Task 2.10
  - **구현 내용**:
    - 상수: 폰트 목록, 3x3 앵커 좌표, 텍스트 그림자 CSS 프리셋 정의
    - `packages/shared/src/index.ts`에서 모든 스키마, 타입, 유틸리티 함수 export
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared typecheck && pnpm --filter @repo/shared test`가 모두 성공한다.

---

## 3. 검증 명령어

```bash
# packages/shared 전체 타입 검사
pnpm --filter @repo/shared typecheck

# packages/shared 전체 단위 테스트 실행
pnpm --filter @repo/shared test
```
