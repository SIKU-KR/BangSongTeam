# Goal: [M3B-2] 덱·프레젠테이션 서버 CRUD (스키마 → 쿼리 → 라우트)

> **마일스톤**: M3-B (계정·서버 저장)
> **태스크 번호**: `tasks_3.md`
> **선행 조건**: `docs/tasks/m3/tasks_2.md` 완료 (Better Auth + requireAuth)
> **목표**: 로컬 IndexedDB 문서와 1:1로 대응하는 문서 단위 업서트 API를 만들어, 프레젠테이션·보관함 곡을 D1에 저장하고 되읽을 수 있게 한다
> **완료 기준 (DoD)**: 로그인한 사용자가 `PUT /api/presentations/:id`로 저장한 문서를 `GET /api/presentations`로 그대로 되받고, 다른 사용자의 문서는 조회·수정·삭제가 모두 막힌다

> **구현 현황 (2026-09-22)**
>
> - Task 2.1~2.8 완료. 전체 **433개 / 58파일 Green**.
> - 작업 중 기존 코드의 보안·정확성 결함 2건을 함께 고쳤다:
>   1. `createPresentationWithClonedDecks`가 원본 덱을 id로만 조회해 **남의 비공개 덱도 복제**할 수 있었다. 소유자이거나 공개 덱일 때만 복제하도록 고쳤다.
>   2. `deletePresentation`·`deleteDeckScoped`의 `(result.rowsAffected ?? 1) > 0`이 **남의 문서 삭제 시도까지 성공으로 보고**했다. D1은 `rowsAffected`를 주지만 테스트용 better-sqlite3 클라이언트는 주지 않아 `?? 1` 폴백이 걸린다. 소유권을 먼저 확인하도록 바꿨다.
> - `packages/db`에 `@repo/shared` 의존성을 추가했다. CLAUDE.md §6.1이 JSON 컬럼을 해당 Zod 스키마로 검증하라고 요구하므로 필요하다. ESLint 경계 규칙은 프론트엔드→db만 막으므로 위반이 아니다.
> - 워커 테스트를 `singleWorker: true`로 직렬화했다. `isolatedStorage: false`로 D1을 공유하는데 `sync.test.ts`가 `beforeEach`에서 테이블을 비우기 때문이다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **`userId`는 언제나 세션에서 온다**: 요청 본문의 `userId`는 신뢰하지 않고 덮어쓴다. D1에는 RLS가 없으므로 모든 쿼리 헬퍼가 `userId`를 필수 인자로 받는다.
2. **문서 단위로 주고받는다**: 로컬은 덱을 임베드한 비정규화 문서 1건, 서버는 `presentations`/`presentation_items`/`decks` 3테이블 정규화다. **경계에서 변환하고, 클라이언트가 만든 id를 그대로 보존한다.** id가 기기마다 달라지면 동기화가 병합이 아니라 중복 생성이 된다.
3. **타입은 하나다**: 저장·전송 전용 interface를 새로 만들지 않는다. `@repo/shared`의 `Presentation`/`Deck`에서 유도한다.
4. **행↔DTO 변환은 한 곳에서**: `packages/db`의 `Deck`(Drizzle 추론, `slides: string`)과 `@repo/shared`의 `Deck`(`slides: Slide[]`)은 이름만 같고 다른 타입이다. 라우트마다 `JSON.parse`를 흩뿌리면 조용히 어긋난다.
5. **D1에는 대화형 트랜잭션이 없다**: 문서 업서트는 `db.batch()`로 묶는다. 루프로 N번 await하면 중간 실패 시 반쪽짜리 문서가 남는다.
6. **RPC 추론을 깨지 않는다**: 라우트는 `c.json(payload, 200)`처럼 상태 코드 리터럴을 명시하고, `worker/index.ts`의 단일 체인 안에서 마운트한다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 2.1: 문서 스키마 및 API 계약 확장 (TDD Red 포함)**
  - **대상 파일**: `src/shared/schemas/api.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `PresentationDocumentSchema` — `PresentationSchema`에서 `items[].deck`을 필수로 좁힌 것. 로컬 IndexedDB 문서 모양과 1:1이다
    - `ApiErrorSchema`, `PresentationListResponseSchema`, `DeckListResponseSchema`
    - 기존 6개 요청 스키마(`CreateDeckRequestSchema` 등)는 이미 있으나 아무데서도 안 쓰인다. 이번에 실제로 연결한다
  - **DoD (통과 기준)**: `pnpm --filter @repo/shared vitest run src/schemas/api.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.2: 행↔DTO 매퍼 구현 (TDD)**
  - **대상 파일**: `src/db/queries/mappers.ts`
  - **선행 조건**: Task 2.1
  - **구현 내용**:
    - `toSharedDeck(row)` / `toDeckRow(deck)` — JSON TEXT 컬럼(`slides`, `style`)과 `Date` ↔ ISO 문자열 변환
    - 읽을 때 `SlideSchema.array()`·`DeckStyleSchema`로 검증한다 (CLAUDE.md §6.1). 손상된 행은 던지지 말고 기본값으로 복구해 전체 목록이 죽지 않게 한다
    - `toSharedPresentationDocument(presentation, items)` / 역방향 분해
  - **DoD (통과 기준)**: `pnpm --filter @repo/db vitest run src/queries/mappers.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.3: 덱 쓰기 쿼리 헬퍼 구현 (TDD)**
  - **대상 파일**: `src/db/queries/decks.ts`
  - **선행 조건**: Task 2.2
  - **구현 내용**:
    - `upsertDeck(db, userId, deck)` — 소유자 불일치 시 거부, 있으면 갱신 없으면 삽입
    - `deleteDeckScoped(db, deckId, userId)`
    - 기존 읽기 헬퍼는 그대로 둔다
  - **DoD (통과 기준)**: `pnpm --filter @repo/db vitest run src/queries/decks.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.4: 프레젠테이션 문서 업서트 및 소유권 결함 수정 (TDD)**
  - **대상 파일**: `src/db/queries/presentations.ts`
  - **선행 조건**: Task 2.3
  - **구현 내용**:
    - `upsertPresentationDocument(db, userId, doc)` — 헤더 업서트 후 `presentation_items`와 해당 프레젠테이션 scope 덱을 `db.batch()`로 교체
    - `updatePresentation(db, presentationId, userId, patch)` (제목·예배일)
    - ⚠️ **기존 `createPresentationWithClonedDecks`는 원본 덱을 id로만 조회해 남의 비공개 덱도 복제된다.** 소유자이거나 공개 덱일 때만 복제하도록 고친다
  - **DoD (통과 기준)**: `pnpm --filter @repo/db vitest run src/queries/presentations.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.5: 프레젠테이션 Worker 라우트 구현**
  - **대상 파일**: `src/worker/routes/presentations.ts`
  - **선행 조건**: Task 2.4
  - **구현 내용**:
    - `GET /` (내 문서 전체), `PUT /:id` (문서 업서트), `DELETE /:id`
    - `requireAuth`를 라우터 전체에 적용하고 `userId`는 세션에서만 가져온다
    - `routes/backgrounds.ts`의 `zValidator` + `createD1Client` 패턴을 그대로 따른다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/routes/presentations.test.ts`가 100% 통과(Green)한다.
  - **구현 메모**: 경로 `:id`와 본문 `id`가 어긋나면 400으로 끊는다. 어느 문서를 쓰는지 모호한 채로 저장하면 엉뚱한 문서를 덮어쓴다.

- [x] **Task 2.6: 덱(보관함) Worker 라우트 구현**
  - **대상 파일**: `src/worker/routes/decks.ts`
  - **선행 조건**: Task 2.5
  - **구현 내용**:
    - `GET /` (내 보관함), `PUT /:id`, `DELETE /:id`
    - FTS5 트리거가 `visibility='public'` UPDATE에 이미 붙어 있어 공개 덱 검색 색인은 따라온다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/routes/decks.test.ts`가 100% 통과(Green)한다.

- [x] **Task 2.7: 라우트 마운트 및 교차 사용자 격리 통합 테스트**
  - **대상 파일**: `src/worker/index.ts`
  - **선행 조건**: Task 2.6
  - **구현 내용**:
    - 단일 체인 안에서 `.route("/api/presentations", ...)`, `.route("/api/decks", ...)` 마운트
    - **A 사용자가 저장한 문서를 B 사용자가 읽지·고치지·지우지 못하는 것을 통합 테스트로 고정한다.** 이것이 D1에 RLS가 없다는 사실에 대한 유일한 방어선이다
  - **DoD (통과 기준)**: `pnpm --filter web vitest run worker/`가 100% 통과(Green)한다.
  - **구현 메모**: 격리 검증은 `worker/routes/sync.test.ts`에 두고 세션 리더만 주입했다(OAuth 왕복은 테스트에서 재현 불가). 다만 그 앱은 라우터를 다시 조립하므로 '실제 마운트에 requireAuth가 붙어 있는가'는 증명하지 못한다. 그래서 `index.test.ts`에 실제 앱으로 401을 확인하는 테스트를 따로 뒀다 — 404면 미마운트, 200이면 인증 누락이다.

- [x] **Task 2.8: M3B-2 모노레포 전체 품질 검증**
  - **대상 파일**: 전체 워크스페이스
  - **선행 조건**: Task 2.7
  - **구현 내용**: `pnpm typecheck` / `pnpm lint` / `pnpm test` 전부 Green
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 에러 없이 성공(Exit code 0)한다.

---

## 3. 검증 명령어

```bash
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_4.md`(M3B-3)에서 이 API를 `hc<AppType>` RPC 클라이언트로 붙이고 로그인 게이트를 세운다.
