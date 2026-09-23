# Goal: [M5-1] 스키마·마이그레이션·서버 권한 고정 (packages/shared, packages/db, worker)

> **마일스톤**: M5 (공유·가사 라이브러리)
> **태스크 번호**: `tasks_1.md`
> **선행 조건**: `docs/tasks/m4/tasks_5.md` 완료
> **목표**: 공유에 쓰이는 덱 필드(`visibility`·`forkCount`·출처·게시 중단)를 서버가 소유하게 하고, 프레젠테이션 복제본이 어떤 경로로도 공개·검색되지 않게 막는다. 검색 헬퍼를 짧은 토큰까지 다루도록 다시 짠다
> **완료 기준 (DoD)**: 클라이언트가 `visibility: 'public'`·`forkCount: 999`를 실어 보내도 D1에는 비공개·0으로 저장되고, `scope='presentation'` 덱은 `decks_fts`에 한 건도 들어가지 않는다

> **구현 현황 (2026-09-23)**
>
> - Task 1.1~1.12 완료. 전체 **726개 / 91파일 Green**.
> - **설계에서 바뀐 것 — FTS 갱신 트리거를 하나로 합쳤다.** 처음에는 '빼기'·'넣기' 트리거 둘로 나눴는데, SQLite가 나중에 만든 트리거를 먼저 실행해 방금 넣은 행을 지웠다(제목을 고친 공개 덱이 검색에서 사라짐). `search.test.ts`의 트리거 추적 테스트가 잡았다.
> - **설계에서 바뀐 것 — `rowid` 연결을 쓰지 않는다.** TEXT 기본키 테이블의 rowid는 VACUUM에서 바뀔 수 있다. 대신 트리거가 `old` 행이 색인 대상이었을 때만 FTS를 건드려 세트 동기화의 불필요한 FTS 스캔을 없앴다.
> - `publicDeckCondition()`은 `queries/publicScope.ts`에 따로 뒀다. `decks.ts`와 `search.ts`가 서로를 import하는 순환을 피하기 위해서다.
> - `sanitizeFts5Query`와 옛 검색 테스트는 `search.ts`/`search.test.ts`로 옮겼다(CLAUDE.md §5.2가 지정한 위치).
> - worker 테스트(`sync.test.ts`)에 workerd 실 D1로 이 파일의 DoD 두 가지를 고정했다: 공개로 보낸 세트 복제본이 비공개로 저장되고 `decks_fts`에 0건, 보관함 PUT이 `forkCount: 999`를 0으로 받는다.

> **배경 (2026-09-23 조사)**: M4까지의 코드에서 두 가지 누출 경로를 확인했다.
>
> 1. `cloneDeckForPresentation`이 원본의 `visibility`·`forkCount`를 그대로 복사한다. 샘플 공유 곡(`visibility: 'public'`)을 세트에 담으면 그 복제본이 `PUT /api/presentations/:id`로 D1에 들어가고, `trg_decks_insert`(조건: `visibility='public'`만)가 `decks_fts`에 색인한다.
> 2. `upsertDeck`은 클라이언트 DTO를 `userId`만 빼고 그대로 쓴다. `forkCount`·`visibility`·`scope`를 클라이언트가 마음대로 바꿀 수 있다.

---

## 1. 아키텍처 가드레일 & 준수 사항

1. **공유 필드는 서버 소유다**: `visibility`, `forkCount`, `origin`, `forkedFrom`(보관함 덱), `forkedFromAuthorName`, `publishedAt`, `takedownAt`은 전용 엔드포인트(M5-3)만 바꾼다. 동기화 `PUT`은 기존 값을 보존하고, 새 행이면 안전한 기본값을 넣는다.
2. **공개 조건은 헬퍼 안에 고정한다**: `scope='library' AND visibility='public' AND takedown_at IS NULL`. 라우트에서 조건을 조립하지 않는다 (CLAUDE.md §6.2).
3. **새 `DeckSchema` 필드는 `.optional()`**: `.default()`를 걸면 `z.infer` 출력 타입에서 필수가 되어 앱·테스트의 `Deck` 리터럴이 전부 깨진다.
4. **FTS DDL은 Drizzle 생성물에 섞지 않는다**: `0000_snapshot.json`이 `decks_fts`를 일반 테이블로 알고 있어 `db:generate`가 FTS 테이블에 `ALTER`를 만든다. 생성된 SQL에서 `_fts` 문장은 지우고, FTS는 손으로 쓴 커스텀 마이그레이션에서만 다룬다.
5. **프론트엔드 변경 없음**: 이 파일은 서버와 공유 계약만 다룬다.

---

## 2. 세부 작업 체크리스트

- [x] **Task 1.1: DeckSchema 공유 필드 확장**
  - **대상 파일**: `packages/shared/src/schemas/deck.ts`, `deck.test.ts`
  - **선행 조건**: 없음
  - **구현 내용**:
    - `DeckOriginSchema = z.enum(['user','fork','catalog'])` — 덱이 처음 어떻게 생겼는지. 루트 버전 판정(PRD 4.8)의 근거
    - 선택 필드: `contributeToCatalog: boolean`, `origin`, `forkedFromAuthorName: string(≤100) | null`, `publishedAt: datetime | null`, `takedownAt: datetime | null`
    - 옛 페이로드(새 필드 없음)가 그대로 파싱되는지 테스트
  - **DoD (통과 기준)**: `pnpm vitest run packages/shared/src/schemas/deck.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.2: 공유 라이브러리 API 계약**
  - **대상 파일**: `packages/shared/src/schemas/library.ts`, `library.test.ts`, `api.ts`, `catalog.ts`
  - **선행 조건**: Task 1.1
  - **구현 내용**:
    - `VisibilityUpdateRequestSchema` — `{visibility:'public', acceptedCopyrightNotice: z.literal(true)}` | `{visibility:'private'}`
    - `PublicDeckSummarySchema`(id·title·artist·authorName·forkedFromAuthorName·forkCount·backgroundId·firstSlidePreview·slideCount·catalogId·updatedAt), `PublicDeckDetailSchema`(+slides·lyricsRaw·style). `userId`는 내보내지 않는다
    - `DeckMutationResponseSchema {deck}`, `ForkDeckResponseSchema {deck, alreadyOwned}`, `ImportCatalogResponseSchema {deck}`
    - `CatalogCandidatesQuerySchema {title, artist}`, `CatalogCandidateSchema`, `CatalogLyricSummarySchema`
    - `ReportReasonSchema`(`lyrics_error|inappropriate|copyright|correction`), `CreateReportRequestSchema {targetType, targetId, reason, details?(≤500)}`
    - `CatalogCanonicalSourceSchema`(`user|llm|popular_root|operator`)를 `catalog.ts`에 추가
    - `api.ts`의 `SearchCatalogQuerySchema.q`는 빈 문자열을 허용한다(빈 값 = 인기순 둘러보기). `SearchCatalogResponseSchema`는 위 요약 스키마를 쓴다
  - **DoD (통과 기준)**: `pnpm vitest run packages/shared/src/schemas/`가 100% 통과(Green)한다.

- [x] **Task 1.3: Drizzle 스키마 확장**
  - **대상 파일**: `packages/db/src/schema/decks.ts`, `lyrics.ts`, `reports.ts`
  - **선행 조건**: Task 1.2
  - **구현 내용**:
    - `decks`: `contribute_to_catalog`(boolean, 기본 false), `origin`(기본 `'user'`), `forked_from_author_name`, `published_at`, `takedown_at`, 인덱스 `idx_decks_forked_from(user_id, forked_from)`
    - `decksFts`에 `lyrics` 컬럼, `lyricsCatalogFts`(catalog_id·title·artist) 쿼리 빌더용 정의
    - `lyrics_catalog`: `canonical_source`(기본 `'user'`), `idx_lyrics_catalog_norm`을 **unique**로 — 동시 첫 기여가 카탈로그를 두 개 만드는 경합을 막는다. 운영 DB에는 기여 경로가 쓰인 적이 없어 카탈로그 행이 0건이다
    - `reports`: `details`, `resolved_at`, `resolution_note`, 인덱스 `(status, created_at)`·`(target_type, target_id)`
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 에러 없이 통과한다.

- [x] **Task 1.4: 생성 마이그레이션 `0003`**
  - **대상 파일**: `packages/db/drizzle/0003_m5_sharing.sql` (+ `meta/`)
  - **선행 조건**: Task 1.3
  - **구현 내용**: `pnpm --filter @repo/db db:generate --name m5_sharing`. 생성된 SQL에서 `*_fts`를 건드리는 문장을 손으로 지운다. 스냅샷은 유지한다
  - **DoD (통과 기준)**: `grep -c "_fts" packages/db/drizzle/0003_m5_sharing.sql`이 0을 출력한다.

- [x] **Task 1.5: 커스텀 FTS 마이그레이션 `0004`**
  - **대상 파일**: `packages/db/drizzle/0004_m5_fts.sql`
  - **선행 조건**: Task 1.4
  - **구현 내용**:
    - 옛 트리거 3개와 `decks_fts`를 지우고 `lyrics` 컬럼을 넣어 다시 만든다 (공유 곡 가사 본문 검색)
    - 데이터 정리: `scope='presentation'` 덱은 `visibility='private', fork_count=0`. 공개 동의 기록(`published_at`)이 없는 공개 덱도 비공개로 되돌린다 — 지금까지 공개 경로가 없었으므로 모두 샘플에서 흘러든 값이다
    - 트리거 조건: `new.scope='library' AND new.visibility='public' AND new.takedown_at IS NULL`. 삭제·갱신 트리거도 `old` 행이 색인 대상이었을 때만 FTS를 건드린다 — 세트 동기화는 덱을 매번 지우고 다시 넣으므로 조건 없이 걸면 곡마다 FTS를 훑는다. (`rowid` 연결은 쓰지 않는다: TEXT 기본키 테이블의 rowid는 VACUUM에서 바뀔 수 있다)
    - `lyrics_catalog_fts(catalog_id UNINDEXED, title, artist, tokenize='trigram')` + 트리거 + backfill
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/worker/index.test.ts`가 통과한다 (workerd에서 전 마이그레이션 적용).

- [x] **Task 1.6: 테스트 DB가 모든 마이그레이션을 적용**
  - **대상 파일**: `packages/db/src/test-utils.ts`
  - **선행 조건**: Task 1.5
  - **구현 내용**: `drizzle/*.sql`을 이름순으로 적용한다. 배경 시드(`0002`)는 테스트가 직접 넣는 배경과 겹치므로 건너뛴다. better-sqlite3는 외래키를 강제하지 않는다는 주석을 남긴다
  - **DoD (통과 기준)**: `pnpm vitest run packages/db`가 100% 통과(Green)한다.

- [x] **Task 1.7: 매퍼 — 새 필드 왕복과 프레젠테이션 덱 강제값**
  - **대상 파일**: `packages/db/src/queries/mappers.ts`, `mappers.test.ts`
  - **선행 조건**: Task 1.6
  - **구현 내용**:
    - 새 필드를 Date↔ISO, boolean으로 매핑한다
    - `fromPresentationDocument`는 `visibility:'private'`, `forkCount:0`, `publishedAt/takedownAt:null`, `contributeToCatalog:false`를 강제한다. `forkedFrom`(= 복제해 온 보관함 덱)·`forkedFromAuthorName`(표시용)은 클라이언트 값을 유지한다
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/mappers.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.8: 모르는 카탈로그 id 방어**
  - **대상 파일**: `packages/db/src/queries/catalogRefs.ts`, `catalogRefs.test.ts`, `presentations.ts`
  - **선행 조건**: Task 1.7
  - **구현 내용**: `nullifyUnknownCatalogs(db, rows)` — `nullifyUnknownBackgrounds`와 같은 패턴. `decks.catalog_id`도 D1이 강제하는 외래키라, 운영자가 카탈로그를 나누거나 지운 뒤 옛 id를 든 세트가 오면 `db.batch()` 전체가 롤백된다(M4 배경 사고와 같은 모양). `upsertPresentationDocument`에 적용한다
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/catalogRefs.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.9: `upsertDeck` 서버 필드 보존**
  - **대상 파일**: `packages/db/src/queries/decks.ts`, `decks.test.ts`
  - **선행 조건**: Task 1.8
  - **구현 내용**:
    - `scope:'library'`, `presentationId:null`을 강제한다
    - 새 행: `visibility:'private'`, `forkCount:0`, `origin:'user'`, `forkedFrom:null`, `forkedFromAuthorName:null`, `publishedAt/takedownAt:null`
    - 기존 행: 위 서버 필드를 기존 행 값으로 유지한다. `catalogId`는 클라이언트가 null을 보내도 서버 값이 있으면 유지한다
    - `nullifyUnknownCatalogs` 적용. 반환값을 `SharedDeck | null`(남의 덱이면 null)로 바꾼다
    - `getPublicById`에 scope·takedown 조건을 더한다
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/decks.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.10: 검색 헬퍼 재작성 (TDD)**
  - **대상 파일**: `packages/db/src/queries/search.ts`, `search.test.ts` (CLAUDE.md §5.2가 지정한 위치)
  - **선행 조건**: Task 1.9
  - **구현 내용**:
    - `planSearch(q)` — 새니타이즈 후 토큰으로 나눈다. 3자 이상 토큰은 FTS `MATCH`, 2자 이하 토큰은 `LIKE '%t%' ESCAPE '\'`. 모두 AND. 빈 쿼리는 '둘러보기'
    - `searchPublicDecks(db, q, limit)` — 작성자 이름(`user.name`) 조인, `fork_count DESC, updated_at DESC`
    - `searchCatalog(db, q, limit)` — 제목·아티스트, `version_count DESC`
    - 옛 `decks.ts`의 `searchPublicDecks`는 이 파일로 옮기고 테스트도 옮긴다
    - 케이스: `"주 은혜"`, `"시선"`, `"%"`·`"_"` 리터럴, FTS 연산자 주입, `scope='presentation'` 공개 행·게시 중단 행 비노출, 빈 쿼리 인기순
  - **DoD (통과 기준)**: `pnpm vitest run packages/db/src/queries/search.test.ts`가 100% 통과(Green)한다.

- [x] **Task 1.11: `PUT /api/decks/:id` 보관함 전용**
  - **대상 파일**: `apps/web/worker/routes/decks.ts`, `worker/routes/sync.test.ts`, `worker/routes/lyrics.test.ts`
  - **선행 조건**: Task 1.9
  - **구현 내용**: `scope !== 'library'`면 400. 응답에 저장된 덱을 담는다 `{ok, deck, contributed}` — 클라이언트가 서버 소유 필드를 받아 반영할 수 있게 한다
  - **DoD (통과 기준)**: `pnpm vitest run apps/web/worker/`가 100% 통과(Green)한다.

- [x] **Task 1.12: 전체 검증**
  - **대상 파일**: 없음
  - **선행 조건**: Task 1.1~1.11
  - **DoD (통과 기준)**: `pnpm typecheck && pnpm lint && pnpm test`가 모두 통과한다.

---

## 3. 검증 명령어

```bash
pnpm vitest run packages/shared packages/db
pnpm vitest run apps/web/worker/
pnpm typecheck && pnpm lint && pnpm test
```

---

## 4. 이 태스크 이후

`tasks_2.md` — 보관함 덱을 실제로 서버에 올리고(지금은 `pushDeck`을 아무도 부르지 않는다), 가사 기여를 덱 플래그 기반 서버 판정으로 바꾼다.
