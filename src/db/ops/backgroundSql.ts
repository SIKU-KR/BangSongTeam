/**
 * 기본 제공 배경을 관리하는 운영 SQL. `scripts/importBackgrounds.mjs`가 `:name`
 * 자리에 값을 채워 `wrangler d1 execute`로 실행하고, 관리자 지정은 손으로 실행한다.
 *
 * 등록 전에 R2 객체(영상·포스터)를 반드시 먼저 올린다. 파일 없는 행은 편집기·송출에서
 * 깨진 배경이 된다 — 첫 마이그레이션에서 시드를 뺀 이유다. 삭제는 거꾸로 행을 먼저
 * 지우고 R2 객체를 나중에 지운다.
 */
export const BACKGROUND_SQL = {
  REGISTER_SERVICE_BACKGROUND: `INSERT INTO backgrounds (id, title, r2_key, poster_key, duration_sec, license, source, kind, size_bytes, description, keywords) VALUES (:id, :title, :r2_key, :poster_key, :duration_sec, :license, 'service', 'video', :size_bytes, :description, :keywords);`,

  UPDATE_BACKGROUND_METADATA: `UPDATE backgrounds SET title = :title, license = :license, description = :description, keywords = :keywords WHERE id = :id;`,

  LIST_BACKGROUNDS: `SELECT id, title, r2_key, poster_key FROM backgrounds ORDER BY title;`,

  COUNT_DECKS_BY_BACKGROUND: `SELECT background_id, count(*) AS decks FROM decks WHERE background_id IS NOT NULL GROUP BY background_id;`,

  DELETE_BACKGROUND: `DELETE FROM backgrounds WHERE id = :id;`,

  FIND_USER_ID_BY_EMAIL: `SELECT id, name, email FROM user WHERE email = :email;`,
} as const;
