# 운영 런북: 신고·게시 중단·대표 가사 교정 (M5)

> **대상**: 서비스 운영자 (관리자 화면은 두지 않는다 — 2026-09-23 결정)
> **정본**: 아래 SQL은 `packages/db/src/ops/moderationSql.ts`에 정의되어 있고, `moderationSql.test.ts`가 실제 마이그레이션 스키마에 대해 실행해 본다. `runbook.test.ts`가 이 문서에 글자 그대로 실려 있는지 확인하므로, **문장을 고칠 때는 두 곳을 함께 고친다.**

## 0. 실행 방법

D1 원격 DB에 SQL 한 문장을 실행한다.

```bash
pnpm dlx wrangler d1 execute prj-ppt-db --remote --config apps/web/wrangler.jsonc --command "<SQL>"
```

- 로컬에서 먼저 확인하려면 `--remote`를 `--local`로 바꾼다.
- `wrangler d1 execute --command`는 바인딩 파라미터를 받지 않는다. 문장 안의 `:name` 자리표시자를 **작은따옴표로 감싼 값**으로 바꿔 넣는다. 값에 작은따옴표가 있으면 두 번 쓴다 (`'주님''의'`).
- 여러 줄 가사를 넣을 때(대표 가사 잠금)는 `--command` 대신 SQL 파일을 만들어 `--file`로 실행한다. 줄바꿈이 그대로 들어간다.
- 변경 문장은 실행 전에 같은 `WHERE` 조건으로 `SELECT`를 먼저 돌려 대상이 맞는지 본다.

## 1. 신고 확인 (매주)

곡 추가 모달의 '신고'와 편집기의 '원본에 교정 제안'이 `reports`에 쌓인다. 사유는 `lyrics_error`(가사 오류)·`correction`(교정 제안)·`inappropriate`(부적절)·`copyright`(저작권 게시 중단 요청)이다.

```sql
-- LIST_PENDING_REPORTS
SELECT r.id, r.target_type, r.target_id, r.reason, r.details, datetime(r.created_at, 'unixepoch') AS reported_at, COALESCE(d.title, c.title) AS target_title FROM reports r LEFT JOIN decks d ON r.target_type = 'deck' AND d.id = r.target_id LEFT JOIN lyrics_catalog c ON r.target_type = 'catalog' AND c.id = r.target_id WHERE r.status = 'pending' ORDER BY r.created_at;
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

## 3. 대표 가사 교정과 잠금 (PRD 4.8 교정)

가사 오류 신고를 확인해 대표 가사를 직접 고치고 잠근다. 잠긴 곡은 자동 정규화가 건너뛴다. M6 시드 가사(운영자 검수)도 이 문장으로 잠근다.

```sql
-- LOCK_CATALOG
UPDATE lyrics_catalog SET lyrics_canonical = :lyrics, status = 'locked', canonical_source = 'operator', normalized_at = unixepoch(), updated_at = unixepoch() WHERE id = :catalog_id;
```

잠금을 풀면 다음 기여부터 다시 자동 정규화된다. 대표 가사는 풀 때 바뀌지 않는다.

```sql
-- UNLOCK_CATALOG
UPDATE lyrics_catalog SET status = CASE WHEN version_count >= 2 THEN 'normalized' ELSE 'single' END, updated_at = unixepoch() WHERE id = :catalog_id AND status = 'locked';
```

## 4. 다른 곡이 한 곡으로 묶였을 때 (곡 분리)

제목·아티스트 정규화 키가 같으면 한 곡으로 묶인다. 실제로 다른 곡이면 나눈다.

1. 등록된 버전을 본다.

```sql
-- LIST_CATALOG_VERSIONS
SELECT v.id, v.user_id, v.deck_id, substr(v.lyrics, 1, 80) AS lyrics_head, datetime(v.created_at, 'unixepoch') AS registered FROM lyrics_versions v WHERE v.catalog_id = :catalog_id ORDER BY v.created_at;
```

2. 새 카탈로그를 만든다. 정규화 키가 unique라 **같은 제목·아티스트로는 만들 수 없다.** 제목을 구별되게 적고(예: `시선 (다른 곡)`), `title_norm`·`artist_norm`은 `packages/shared`의 `normalizeCatalogKey` 규칙(NFKC → 소문자 → 글자·숫자만)대로 적는다. id는 새 uuid다.

```sql
-- CREATE_CATALOG
INSERT INTO lyrics_catalog (id, title, artist, title_norm, artist_norm, lyrics_canonical, version_count, status, canonical_source) VALUES (:catalog_id, :title, :artist, :title_norm, :artist_norm, :lyrics, 0, 'single', 'operator');
```

3. 옮길 버전마다 덱 연결을 먼저, 버전을 나중에 옮긴다 (순서가 바뀌면 덱을 찾는 하위 조회가 빈다).

```sql
-- MOVE_VERSION_DECK_TO_CATALOG
UPDATE decks SET catalog_id = :to_catalog_id WHERE id = (SELECT deck_id FROM lyrics_versions WHERE id = :version_id);
```

```sql
-- MOVE_VERSION_TO_CATALOG
UPDATE lyrics_versions SET catalog_id = :to_catalog_id, updated_at = unixepoch() WHERE id = :version_id;
```

4. 양쪽 카탈로그의 버전 수를 다시 센다 (각각 한 번씩).

```sql
-- RECOUNT_CATALOG
UPDATE lyrics_catalog SET version_count = (SELECT count(*) FROM lyrics_versions WHERE catalog_id = :catalog_id), updated_at = unixepoch() WHERE id = :catalog_id;
```

같은 사용자가 두 카탈로그에 모두 버전을 가진 경우 `(user_id, catalog_id)` unique에 걸린다. 그때는 옮기지 말고 그 사용자의 한쪽 버전을 그대로 둔다.

## 5. 카탈로그 삭제 (권리자 요청)

버전은 함께 지워지고, 사용자 덱의 카탈로그 연결은 끊긴다(`ON DELETE SET NULL`). 사용자의 덱 자체는 남는다.

```sql
-- DELETE_CATALOG
DELETE FROM lyrics_catalog WHERE id = :catalog_id;
```

## 6. Qwen 정규화 원격 확인 (배포 후 1회, 모델이 바뀌면 다시)

로컬·테스트는 원격 바인딩을 끄므로 가짜 모델로만 검증된다(`docs/tasks/m5/tasks_4.md`). 실제 모델이 사고 모드 끄기(`enable_thinking: false`)를 지키고 가사만 돌려주는지 Workers AI REST API로 한 번 확인한다.

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/qwen/qwen3.8-27b" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d '{"temperature":0,"max_tokens":512,"chat_template_kwargs":{"enable_thinking":false},"messages":[{"role":"system","content":"You are an expert lyric editor for Korean church worship songs. Output only the lyrics text."},{"role":"user","content":"### Version 1\n주의 은혜 아래 나 거하며\n### End of version 1\n\n### Version 2\n주의 은혜아래 나 거하며\n### End of version 2\n\nReturn the single canonical version."}]}'
```

통과 기준:

- 응답 본문(`result.choices[0].message.content` 또는 `result.response`)에 `<think>`가 없다
- 입력에 있는 줄만 돌아온다 (예: `주의 은혜 아래 나 거하며`)
- `finish_reason`이 `stop`이다

실패하면 코드는 자동으로 최다 등록 버전(`canonical_source = 'popular_root'`)으로 떨어지므로 서비스는 계속 돈다. 대신 정규화 품질이 사라지므로 모델 템플릿 옵션을 다시 확인한다. 정규화 결과 분포는 아래로 본다.

```sql
SELECT canonical_source, status, count(*) FROM lyrics_catalog GROUP BY canonical_source, status;
```

## 7. LLM 호출 비용 상한 (선택)

`AI_GATEWAY_ID` 시크릿을 두면 정규화 호출이 AI Gateway를 거친다. Gateway에서 월 비용 상한·요청 제한을 걸고, 상한에 닿아 호출이 실패하면 코드가 최다 등록 버전으로 자동 전환한다(PRD 9장).

```bash
pnpm dlx wrangler secret put AI_GATEWAY_ID --config apps/web/wrangler.jsonc
```
