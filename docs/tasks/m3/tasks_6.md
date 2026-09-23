# Goal: [M3B-5] 가사 기여 및 M3-B 통합 검증

> **2026-09-23 범위 변경**: LLM 가사 정규화와 가사 라이브러리(카탈로그·가사 기여·대표 가사·곡 식별)는 MVP에서 제거됐다 (`packages/db/drizzle/0005_remove_catalog.sql`). 공유 라이브러리는 같은 곡을 여러 사람이 따로 공개하는 게시판(가져간 횟수순)만 남는다. 이 문서의 해당 부분은 이력으로 남긴다.

> **마일스톤**: M3-B (계정·서버 저장)
> **태스크 번호**: `tasks_6.md`
> **선행 조건**: `docs/tasks/m3/tasks_5.md` 완료 (동기화 계층)
> **목표**: 곡을 저장할 때 가사를 공용 카탈로그에 기여하고, M3-B 완료 기준을 통합 검증한 뒤 문서를 실제 구현과 맞춘다
> **완료 기준 (DoD)**: 같은 곡을 두 사용자가 저장하면 `lyrics_versions`에 2개 루트 버전이 쌓이고, 저장 → 조회 → 다른 기기 복원 왕복이 통합 테스트로 고정된다

> **구현 현황 (2026-09-22)**
>
> - Task 5.1~5.6 완료.
> - 정규화 키는 **부호·공백만 무시하고 단어는 존중한다.** '시선'과 '시선 (Live)'를 한 곡으로 합치면 운영자가 의도적으로 나눈 편곡 버전까지 뭉뚱그려진다.
> - 2-기기 왕복을 서버 레벨에서 고정했다(곡 수·순서·스타일·배경·슬라이드 내용·id 보존). **실제 2대 PC 확인은 OAuth 자격증명이 있어야 한다.**

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **1인 1표**: `lyrics_versions`에 `(user_id, catalog_id)` 유니크가 걸려 있다. 같은 사용자가 같은 곡을 여러 번 저장해도 버전은 하나다.
2. **잠금 존중**: `status = 'locked'`인 카탈로그는 운영자가 검수한 값이다. 기여를 받아도 `lyrics_canonical`을 건드리지 않는다.
3. **AI 정규화는 M5다**: 여기서는 버전 저장까지만 한다. Workers AI 호출은 넣지 않는다.
4. **기여는 선택이다**: `CreateDeckRequestSchema.contributeToCatalog`가 이미 있다. 끄면 카탈로그를 건드리지 않는다.
5. **문서를 코드와 맞춘다**: 로그인 필수 결정으로 `prd.md:150`이 실제와 어긋났다. PRD·TECH_SPEC·`docs/tasks/AGENTS.md`를 이번에 함께 고친다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 5.1: 가사 정규화 키 유틸 (TDD)**
  - **대상 파일**: `packages/shared/src/utils/catalogKey.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `normalizeCatalogKey(title, artist)` — 공백·특수문자 제거, 소문자화. `lyrics_catalog.title_norm`/`artist_norm`의 생성 규칙을 한 곳에 둔다
    - 서버와 클라이언트가 같은 규칙을 써야 같은 곡이 같은 카탈로그로 모인다
  - **DoD (통과 기준)**: `pnpm vitest run packages/shared/src/utils/catalogKey.test.ts`가 100% 통과(Green)한다.

- [x] **Task 5.2: 카탈로그 기여 쿼리 헬퍼 (TDD)**
  - **대상 파일**: `packages/db/src/queries/lyrics.ts`
  - **선행 조건**: Task 5.1
  - **구현 내용**:
    - `contributeLyrics(db, { userId, deckId, title, artist, lyrics })` — 정규화 키로 카탈로그를 찾고 없으면 만든 뒤 `upsertLyricVersion`
    - `version_count`를 실제 버전 수로 갱신한다
    - `status = 'locked'`면 `lyrics_canonical`을 건드리지 않는다
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/lyrics.test.ts`가 100% 통과(Green)한다.

- [x] **Task 5.3: 덱 저장 시 기여 연결**
  - **대상 파일**: `apps/web/worker/routes/decks.ts`
  - **선행 조건**: Task 5.2
  - **구현 내용**:
    - `PUT /api/decks/:id`에 `?contribute=true`를 받아 기여를 수행한다
    - 기여 실패가 덱 저장 자체를 실패시키지 않는다 (가사 공유는 부가 기능이다)
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/routes/lyrics.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: 기여 실패가 덱 저장을 되돌리지 않는다. 공용 카탈로그는 부가 기능인데 여기서 500을 내면 사용자는 자기 곡이 저장되지 않았다고 이해한다.

- [x] **Task 5.4: 2-기기 동기화 왕복 통합 테스트**
  - **대상 파일**: `apps/web/worker/routes/sync.test.ts`
  - **선행 조건**: Task 5.3
  - **구현 내용**:
    - A 기기에서 5곡 세트를 저장 → B 기기(같은 계정, 빈 로컬)에서 받아 → 곡·순서·스타일·배경이 동일함을 검증
    - 이것이 M3-B 완료 기준('다른 PC에서 로그인해 같은 세트를 그대로 송출')의 자동화된 부분이다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/`가 100% 통과(Green)한다.
  - **구현 메모**: `sync.test.ts`가 `beforeEach`에서 배경을 직접 시드한다. `decks.background_id`가 `backgrounds`를 참조하는데, 다른 테스트 파일의 시드에 기대면 파일 실행 순서에 따라 FK 위반으로 깨진다.

- [x] **Task 5.5: 문서 정합화**
  - **대상 파일**: `prd.md`, `docs/TECH_SPEC.md`, `docs/tasks/AGENTS.md`
  - **선행 조건**: Task 5.4
  - **구현 내용**:
    - `prd.md:150`의 '로그인은 편집의 전제 조건이 아니다'를 로그인 필수 결정에 맞게 고친다
    - 마일스톤 표의 M3-A·M3-B 상태를 갱신한다
    - `TECH_SPEC §5.5`의 Phase 3을 '구현 완료'로 바꾸고 실제 설계(문서 단위 LWW, 오프라인 세션 캐시)를 적는다
    - `docs/tasks/AGENTS.md §2.1` 현재 위치 표를 갱신한다
  - **DoD (통과 기준)**: 로그인 관련 서술이 코드와 어긋나는 곳이 없다 (`grep -n "전제 조건이 아니다" prd.md`가 0건).

- [x] **Task 5.6: M3-B 전체 품질 검증**
  - **대상 파일**: 전체 워크스페이스
  - **선행 조건**: Task 5.5
  - **구현 내용**: `pnpm typecheck` / `pnpm lint` / `pnpm test` 전부 Green
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 에러 없이 성공(Exit code 0)한다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 마일스톤 이후

M3-B 완료 선언에는 **실제 카카오·네이버 자격증명으로 2대의 PC에서 로그인해 같은 세트를 송출**하는 확인이 남는다. 그 다음은 M4(오프라인 영상 캐시·발표자 보기) 또는 M2 잔여 3건이며, 어느 쪽을 먼저 할지는 실사용에서 나온 문제의 성격으로 정한다.
