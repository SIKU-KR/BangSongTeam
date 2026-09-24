/**
 * 기본 제공 배경을 관리하는 운영 SQL. 앱의 관리자 업로드를 쓸 수 없을 때(대량 등록,
 * 복구)와 관리자 지정에 `wrangler d1 execute`로 실행한다.
 * docs/ops/background-runbook.md 및 backgroundSql.test.ts와 동기화된다.
 *
 * 등록 전에 R2 객체(영상·포스터)를 반드시 먼저 올린다. 파일 없는 행은 편집기·송출에서
 * 깨진 배경이 된다 — 첫 마이그레이션에서 시드를 뺀 이유다.
 */
export const BACKGROUND_SQL = {
  REGISTER_SERVICE_BACKGROUND: `INSERT INTO backgrounds (id, title, r2_key, poster_key, duration_sec, license, tags, source, kind, size_bytes) VALUES (:id, :title, :r2_key, :poster_key, :duration_sec, :license, :tags, 'service', 'video', :size_bytes);`,

  LIST_SERVICE_BACKGROUNDS: `SELECT id, title, r2_key, poster_key, duration_sec, size_bytes, tags FROM backgrounds WHERE source = 'service' ORDER BY title;`,

  COUNT_DECKS_USING_BACKGROUND: `SELECT count(*) AS decks FROM decks WHERE background_id = :background_id;`,

  DELETE_SERVICE_BACKGROUND: `DELETE FROM backgrounds WHERE id = :background_id AND source = 'service';`,

  FIND_USER_ID_BY_EMAIL: `SELECT id, name, email FROM user WHERE email = :email;`,
} as const;
