/**
 * 기본 제공 배경을 관리하는 운영 SQL. `scripts/importBackgrounds.mjs`가 `:name`
 * 자리에 값을 채워 `wrangler d1 execute`로 실행한다. 한 항목이 여러 문장이면 줄마다
 * 한 문장이다. `:keywords`는 키워드 문자열 배열의 JSON이다.
 *
 * 등록 전에 R2 객체(영상·포스터)를 반드시 먼저 올린다. 파일 없는 행은 편집기·송출에서
 * 깨진 배경이 된다 — 첫 마이그레이션에서 시드를 뺀 이유다. 삭제는 거꾸로 행을 먼저
 * 지우고 R2 객체를 나중에 지운다.
 */
export const BACKGROUND_SQL = {
  REGISTER_SERVICE_BACKGROUND: [
    `INSERT INTO backgrounds (id, title, kind, r2_key, poster_key, duration_sec, size_bytes, description, created_at) VALUES (:id, :title, 'video', :r2_key, :poster_key, :duration_sec, :size_bytes, :description, unixepoch() * 1000);`,
    `INSERT OR IGNORE INTO background_keywords (background_id, keyword) SELECT :id, value FROM json_each(:keywords);`,
  ].join("\n"),

  UPDATE_BACKGROUND_METADATA: [
    `UPDATE backgrounds SET title = :title, description = :description WHERE id = :id;`,
    `DELETE FROM background_keywords WHERE background_id = :id;`,
    `INSERT OR IGNORE INTO background_keywords (background_id, keyword) SELECT :id, value FROM json_each(:keywords);`,
  ].join("\n"),

  LIST_BACKGROUNDS: `SELECT id, title, r2_key, poster_key FROM backgrounds ORDER BY title;`,

  COUNT_DECKS_BY_BACKGROUND: `SELECT background_id, deck_count AS decks FROM background_usage WHERE deck_count > 0;`,

  DELETE_BACKGROUND: `DELETE FROM backgrounds WHERE id = :id;`,
} as const;
