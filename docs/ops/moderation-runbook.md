# 운영 런북: 신고·게시 중단 (M5)

> **대상**: 서비스 운영자 (관리자 화면은 두지 않는다 — 2026-09-23 결정)
> **정본**: 아래 SQL은 `src/db/ops/moderationSql.ts`에 정의되어 있고, `moderationSql.test.ts`가 실제 마이그레이션 스키마에 대해 실행해 본다. `runbook.test.ts`가 이 문서에 글자 그대로 실려 있는지 확인하므로, **문장을 고칠 때는 두 곳을 함께 고친다.**

## 0. 실행 방법

D1 원격 DB에 SQL 한 문장을 실행한다.

```bash
pnpm dlx wrangler d1 execute prj-ppt-db --remote --command "<SQL>"
```

- 로컬에서 먼저 확인하려면 `--remote`를 `--local`로 바꾼다.
- `wrangler d1 execute --command`는 바인딩 파라미터를 받지 않는다. 문장 안의 `:name` 자리표시자를 **작은따옴표로 감싼 값**으로 바꿔 넣는다. 값에 작은따옴표가 있으면 두 번 쓴다 (`'주님''의'`).
- 변경 문장은 실행 전에 같은 `WHERE` 조건으로 `SELECT`를 먼저 돌려 대상이 맞는지 본다.

## 1. 신고 확인 (매주)

곡 추가 모달의 '신고'와 편집기의 '원본에 교정 제안'이 `reports`에 쌓인다. 대상은 모두 공개 덱이다. 사유는 `lyrics_error`(가사 오류)·`correction`(교정 제안)·`inappropriate`(부적절)·`copyright`(저작권 게시 중단 요청)이다.

```sql
-- LIST_PENDING_REPORTS
SELECT r.id, r.target_type, r.target_id, r.reason, r.details, datetime(r.created_at, 'unixepoch') AS reported_at, d.title AS target_title FROM reports r LEFT JOIN decks d ON r.target_type = 'deck' AND d.id = r.target_id WHERE r.status = 'pending' ORDER BY r.created_at;
```

처리하지 않을 신고는 반려하고, 처리한 신고는 완료로 적는다.

```sql
-- RESOLVE_REPORT
UPDATE reports SET status = 'resolved', resolved_at = unixepoch(), resolution_note = :note WHERE id = :report_id;
```

```sql
-- REJECT_REPORT
UPDATE reports SET status = 'rejected', resolved_at = unixepoch(), resolution_note = :note WHERE id = :report_id;
```

## 2. 공개 덱 게시 중단 (저작권·부적절 콘텐츠)

PRD 4.7·9장의 게시 중단 절차다. 저작권자 요청은 **받은 당일** 처리한다.

1. 덱을 내린다. 비공개가 되고 검색 인덱스에서 빠지며(`decks_fts` 트리거), 소유자는 다시 공개할 수 없다(서버가 409로 거절한다).

```sql
-- TAKEDOWN_DECK
UPDATE decks SET visibility = 'private', takedown_at = unixepoch() WHERE id = :deck_id AND scope = 'library';
```

2. 그 덱을 가져가 다시 공개한 사본을 찾는다. 저작권 요청이면 각각 1번을 반복한다.

```sql
-- LIST_PUBLIC_DESCENDANTS
SELECT id, user_id, title, datetime(published_at, 'unixepoch') AS published FROM decks WHERE forked_from = :deck_id AND scope = 'library' AND visibility = 'public' AND takedown_at IS NULL;
```

3. 그 대상의 대기 중 신고를 한꺼번에 완료로 적는다.

```sql
-- RESOLVE_REPORTS_FOR_TARGET
UPDATE reports SET status = 'resolved', resolved_at = unixepoch(), resolution_note = :note WHERE target_id = :target_id AND status = 'pending';
```

오판이었다면 게시 중단을 푼다. 덱은 비공개로 남고, 소유자가 원하면 다시 공개한다.

```sql
-- RESTORE_DECK
UPDATE decks SET takedown_at = NULL WHERE id = :deck_id AND scope = 'library';
```

**하지 않는 것**: 가져간 사람의 비공개 사본은 지우지 않는다(PRD 4.7 '비공개 전환·삭제 후에도 복제본 유지'). 권리자가 사본 삭제까지 요구하면 별도로 법률 검토를 거친다.

> 가사 라이브러리(곡 단위 대표 가사, LLM 정규화)는 MVP 범위에서 뺐다 (2026-09-23). 대표 가사 잠금·곡 분리·카탈로그 삭제 절차도 함께 없어졌다. 공유 라이브러리는 같은 곡을 여러 사람이 따로 공개하는 게시판으로 운영하고, 틀린 가사는 해당 공개 덱의 신고·게시 중단으로 처리한다.
