# Goal: [M0-3] D1 SQLite 스키마, FTS5 및 쿼리 헬퍼 (packages/db)

> **마일스톤**: M0 (인프라 및 기반 구성)  
> **태스크 번호**: `tasks_3.md`  
> **선행 조건**: `docs/tasks/m0/tasks_2.md` 완료  
> **목표**: Cloudflare D1(SQLite)에 영속화할 Drizzle ORM 테이블 스키마, FTS5 Trigram 가상 테이블 마이그레이션, RLS 부재를 보완하는 중앙 집중식 보안 쿼리 헬퍼를 작성한다.

---

## 1. 아키텍처 가드레일 & 준수 사항

- **D1 보안 및 스코핑 (No RLS)**: D1 SQLite는 RLS가 없으므로 모든 덱/콘티 조회 및 수정 쿼리는 반드시 `userId` 일치 여부를 강제하는 `packages/db/src/queries/` 헬퍼를 통해 수행한다.
- **공개 덱 유출 차단**: 공개 덱 조회는 `where(eq(decks.visibility, 'public'))`를 조건으로 무조건 강제한다.
- **Clone-on-Add 격리**: 콘티 추가 덱은 `scope = 'setlist'`, `setlist_id = id`로 저장되고, 사용자 라이브러리는 `scope = 'library'`로만 조회하여 고아 데이터 및 라이브러리 오염을 원천 차단한다.

---

## 2. 세부 작업 체크리스트

- [ ] **Task 3.1: packages/db 패키지 구성 및 Drizzle Kit 설정**
  - **대상 파일**: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
  - **선행 조건**: `docs/tasks/m0/tasks_2.md`
  - **구현 내용**:
    - `drizzle-orm`, `drizzle-kit`, `@cloudflare/workers-types` 의존성 추가
    - `drizzle.config.ts`에 dialect `'sqlite'`, schema `'./src/schema/index.ts'`, out `'./drizzle'` 설정
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 에러 없이 통과한다.

- [ ] **Task 3.2: Better Auth v1 공식 완결 인증 테이블 스키마 선언**
  - **대상 파일**: `packages/db/src/schema/auth.ts`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - `user`: `id`, `name`, `email(nullable)`, `emailVerified`, `image`, 타임스탬프
    - `session`: `id`, `userId(FK cascade)`, `token(unique)`, `expiresAt`, `ipAddress`, `userAgent`, 타임스탬프
    - `account`: `id`, `userId(FK cascade)`, `accountId`, `providerId`, `accessToken`, `refreshToken`, 만료일, `scope`, `idToken`, 타임스탬프
    - `verification`: `id`, `identifier`, `value`, `expiresAt`, 타임스탬프
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 에러 없이 통과한다.

- [ ] **Task 3.3: 가사 카탈로그 및 1인 1표 버전 관리 테이블 스키마 선언**
  - **대상 파일**: `packages/db/src/schema/lyrics.ts`
  - **선행 조건**: Task 3.2
  - **구현 내용**:
    - `lyricsCatalog`: `id`, `title`, `artist`, `titleNorm`, `artistNorm`, `lyricsCanonical`, `versionCount`, `status('single'|'normalized'|'locked')`, 인덱스(`idx_lyrics_catalog_norm`)
    - `lyricsVersions`: `id`, `catalogId(FK cascade)`, `userId(FK)`, `deckId`, `lyrics`, `source`, 복합 고유 인덱스(`uniqueIndex('idx_lyrics_versions_user_catalog').on(userId, catalogId)`)
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 에러 없이 통과한다.

- [ ] **Task 3.4: 배경 미디어 메타데이터 테이블 스키마 선언**
  - **대상 파일**: `packages/db/src/schema/media.ts`
  - **선행 조건**: Task 3.1
  - **구현 내용**:
    - `backgrounds`: `id`, `title`, `r2Key`, `posterKey`, `durationSec`, `license`, `tags(JSON text)`
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 에러 없이 통과한다.

- [ ] **Task 3.5: 덱(Deck) 테이블 스키마 선언 (Clone-on-Add 격리 및 인덱스 최적화)**
  - **대상 파일**: `packages/db/src/schema/decks.ts`
  - **선행 조건**: Task 3.3, Task 3.4
  - **구현 내용**:
    - `decks`: `id`, `userId(FK cascade)`, `catalogId(FK set null)`, `scope('library'|'setlist')`, `setlistId(FK cascade)`, `title`, `artist`, `lyricsRaw`, `slides(JSON TEXT)`, `backgroundId(FK set null)`, `style(JSON TEXT)`, `visibility`, `forkedFrom`, `forkCount`
    - 인덱스: `idx_decks_user_scope(userId, scope)`, `idx_decks_setlist(setlistId)`, `idx_decks_visibility_forks(visibility, forkCount)`
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 에러 없이 통과한다.

- [ ] **Task 3.6: 콘티(Setlist) 및 신고(Report) 테이블 스키마 선언**
  - **대상 파일**: `packages/db/src/schema/setlists.ts`, `packages/db/src/schema/reports.ts`
  - **선행 조건**: Task 3.5
  - **구현 내용**:
    - `setlists`: `id`, `userId(FK cascade)`, `title`, `serviceDate`, 타임스탬프, 인덱스(`idx_setlists_user_date`)
    - `setlistItems`: `id`, `setlistId(FK cascade)`, `deckId(FK cascade)`, `order`, 복합 고유 인덱스(`uniqueIndex.on(setlistId, deckId)`)
    - `reports`: `id`, `userId(FK)`, `targetType('deck'|'catalog')`, `targetId`, `reason`, `status`
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 에러 없이 통과한다.

- [ ] **Task 3.7: 스키마 배럴 및 D1 Drizzle 클라이언트 팩토리 구현**
  - **대상 파일**: `packages/db/src/schema/index.ts`, `packages/db/src/client.ts`
  - **선행 조건**: Task 3.2 ~ Task 3.6
  - **구현 내용**:
    - `schema/index.ts`에서 모든 테이블 및 인덱스 객체 re-export
    - `createD1Client(d1: D1Database)`: Cloudflare D1 바인딩을 주입받아 Drizzle 인스턴스를 생성하는 팩토리 함수 작성
  - **DoD (통과 기준)**: `pnpm --filter @repo/db exec tsc --noEmit`이 통과하고 스키마 타입이 바인딩된다.

- [ ] **Task 3.8: Drizzle 마이그레이션 생성 및 FTS5 Trigram 가상 테이블 작성**
  - **대상 파일**: `packages/db/drizzle/0000_initial.sql`, `packages/db/drizzle/0001_fts5.sql`
  - **선행 조건**: Task 3.7
  - **구현 내용**:
    - `pnpm --filter @repo/db db:generate`로 테이블 생성 SQL 추출
    - `0001_fts5.sql`: `decks_fts USING fts5(deck_id UNINDEXED, title, artist, tokenize='trigram')` 생성 및 공개 덱 동기화 SQLite 트리거(`trg_decks_insert`, `trg_decks_update`, `trg_decks_delete`) 정의
  - **DoD (통과 기준)**: `drizzle/` 디렉토리에 마이그레이션 파일이 정상 생성된다.

- [ ] **Task 3.9: FTS5 새니타이저 및 덱 검색 쿼리 단위 테스트 작성 (TDD Red)**
  - **대상 파일**: `packages/db/src/queries/decks.test.ts`
  - **선행 조건**: Task 3.7
  - **구현 내용**:
    - `sanitizeFts5Query`: 제어 문자 주입 방지 및 큰따옴표 토큰화 검증
    - 3자 이상 FTS5 MATCH 분기 및 2자 이하 LIKE 분기 검증
  - **DoD (통과 기준)**: `pnpm --filter @repo/db vitest run src/queries/decks.test.ts` 실행 시 실패(Red)함을 확인한다.

- [ ] **Task 3.10: D1 보안 가드레일 적용 덱 쿼리 헬퍼 구현 (TDD Green)**
  - **대상 파일**: `packages/db/src/queries/decks.ts`
  - **선행 조건**: Task 3.9
  - **구현 내용**:
    - `sanitizeFts5Query(query: string): string`
    - `getMyLibraryDecks(userId)`: `scope = 'library'` 및 `userId` 강제
    - `getByIdScoped(deckId, userId)`: `userId` 강제
    - `getPublicById(deckId)`: `visibility = 'public'` 강제
    - `searchPublicDecks(query, limit)`: FTS5 Trigram / LIKE 하이브리드 검색
    - `upsertLyricVersion(...)`: 1인 1표 멱등적 업서트
  - **DoD (통과 기준)**: `pnpm --filter @repo/db vitest run src/queries/decks.test.ts`가 100% 통과(Green)한다.

- [ ] **Task 3.11: 콘티 쿼리 헬퍼 구현 및 DB 패키지 엔트리포인트 완성**
  - **대상 파일**: `packages/db/src/queries/setlists.ts`, `packages/db/src/index.ts`
  - **선행 조건**: Task 3.10
  - **구현 내용**:
    - `getSetlistWithDecks(setlistId, userId)`: 세트와 속한 덱 목록 원자적 조회
    - `createSetlistWithClonedDecks(...)`: 콘티에 곡 추가 시 `scope='setlist'`, `setlistId=id`로 덱을 복제 생성하는 트랜잭션 헬퍼
    - `packages/db/src/index.ts`에서 클라이언트 팩토리, 스키마, 쿼리 헬퍼 export
  - **DoD (통과 기준)**: `pnpm --filter @repo/db typecheck && pnpm --filter @repo/db test`가 모두 성공한다.

---

## 3. 검증 명령어

```bash
# 마이그레이션 생성 확인
pnpm --filter @repo/db db:generate

# packages/db 전체 타입 검사
pnpm --filter @repo/db typecheck

# packages/db 전체 단위 테스트
pnpm --filter @repo/db test
```
