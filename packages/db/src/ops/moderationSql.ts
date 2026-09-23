/**
 * 운영자 SQL (M5 신고·게시 중단·대표 가사 교정).
 *
 * 관리자 화면은 두지 않는다. 운영자는 `docs/ops/moderation-runbook.md`의 절차대로
 * `wrangler d1 execute`로 아래 문장을 실행한다. 문장은 여기 한 곳에서만 정의하고,
 * `moderationSql.test.ts`가 실제 스키마에 대해 실행해 보며, `runbook.test.ts`가
 * 런북에 글자 그대로 실려 있는지 확인한다 (둘이 갈라지지 않게).
 *
 * 자리표시자는 `:name` 형식이다. `wrangler d1 execute --command`는 바인딩을
 * 받지 않으므로 런북에서는 값을 작은따옴표 리터럴로 바꿔 넣는다.
 */
export const MODERATION_SQL = {
  /** 처리 대기 중인 신고 (오래된 순) */
  LIST_PENDING_REPORTS: `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, datetime(r.created_at, 'unixepoch') AS reported_at, COALESCE(d.title, c.title) AS target_title FROM reports r LEFT JOIN decks d ON r.target_type = 'deck' AND d.id = r.target_id LEFT JOIN lyrics_catalog c ON r.target_type = 'catalog' AND c.id = r.target_id WHERE r.status = 'pending' ORDER BY r.created_at;`,

  /**
   * 공개 덱 게시 중단. 비공개로 내리고 `takedown_at`을 남겨 소유자가 다시 공개하지
   * 못하게 한다. FTS 트리거가 검색 인덱스에서도 뺀다. 이미 가져간 사본은 남는다.
   */
  TAKEDOWN_DECK: `UPDATE decks SET visibility = 'private', takedown_at = unixepoch() WHERE id = :deck_id AND scope = 'library';`,

  /** 게시 중단 해제. 비공개 상태로 남으며 소유자가 원하면 다시 공개한다 */
  RESTORE_DECK: `UPDATE decks SET takedown_at = NULL WHERE id = :deck_id AND scope = 'library';`,

  /**
   * 게시 중단한 덱을 가져가 다시 공개한 덱 (저작권 요청이면 이것들도 내린다).
   */
  LIST_PUBLIC_DESCENDANTS: `SELECT id, user_id, title, datetime(published_at, 'unixepoch') AS published FROM decks WHERE forked_from = :deck_id AND scope = 'library' AND visibility = 'public' AND takedown_at IS NULL;`,

  /** 대상 하나에 쌓인 대기 중 신고를 한꺼번에 처리 완료로 */
  RESOLVE_REPORTS_FOR_TARGET: `UPDATE reports SET status = 'resolved', resolved_at = unixepoch(), resolution_note = :note WHERE target_id = :target_id AND status = 'pending';`,

  /** 신고 1건 처리 완료 */
  RESOLVE_REPORT: `UPDATE reports SET status = 'resolved', resolved_at = unixepoch(), resolution_note = :note WHERE id = :report_id;`,

  /** 신고 1건 반려 */
  REJECT_REPORT: `UPDATE reports SET status = 'rejected', resolved_at = unixepoch(), resolution_note = :note WHERE id = :report_id;`,

  /**
   * 대표 가사를 운영자가 고치고 잠근다 (PRD 4.8 교정). 잠긴 곡은 자동 정규화가
   * 건너뛴다. M6 시드 가사도 이 문장으로 잠근다.
   */
  LOCK_CATALOG: `UPDATE lyrics_catalog SET lyrics_canonical = :lyrics, status = 'locked', canonical_source = 'operator', normalized_at = unixepoch(), updated_at = unixepoch() WHERE id = :catalog_id;`,

  /** 잠금 해제. 다음 기여부터 다시 자동 정규화된다 (대표 가사는 그대로 남는다) */
  UNLOCK_CATALOG: `UPDATE lyrics_catalog SET status = CASE WHEN version_count >= 2 THEN 'normalized' ELSE 'single' END, updated_at = unixepoch() WHERE id = :catalog_id AND status = 'locked';`,

  /** 한 곡의 등록 버전 목록 (곡 분리 판단용) */
  LIST_CATALOG_VERSIONS: `SELECT v.id, v.user_id, v.deck_id, substr(v.lyrics, 1, 80) AS lyrics_head, datetime(v.created_at, 'unixepoch') AS registered FROM lyrics_versions v WHERE v.catalog_id = :catalog_id ORDER BY v.created_at;`,

  /**
   * 곡 분리용 새 카탈로그. 정규화 키가 unique라 같은 제목·아티스트로는 만들 수 없다 —
   * 제목을 구별되게 적는다 (예: '시선 (다른 곡)').
   */
  CREATE_CATALOG: `INSERT INTO lyrics_catalog (id, title, artist, title_norm, artist_norm, lyrics_canonical, version_count, status, canonical_source) VALUES (:catalog_id, :title, :artist, :title_norm, :artist_norm, :lyrics, 0, 'single', 'operator');`,

  /** 버전 1건과 그 덱을 다른 카탈로그로 옮긴다 (다른 곡이 같은 곡으로 묶였을 때) */
  MOVE_VERSION_TO_CATALOG: `UPDATE lyrics_versions SET catalog_id = :to_catalog_id, updated_at = unixepoch() WHERE id = :version_id;`,
  MOVE_VERSION_DECK_TO_CATALOG: `UPDATE decks SET catalog_id = :to_catalog_id WHERE id = (SELECT deck_id FROM lyrics_versions WHERE id = :version_id);`,

  /** 버전 수 다시 세기 (옮긴 뒤 양쪽 카탈로그에 각각 실행) */
  RECOUNT_CATALOG: `UPDATE lyrics_catalog SET version_count = (SELECT count(*) FROM lyrics_versions WHERE catalog_id = :catalog_id), updated_at = unixepoch() WHERE id = :catalog_id;`,

  /**
   * 카탈로그 삭제 (권리자 요청). 버전은 함께 지워지고, 덱의 연결은 끊긴다
   * (`decks.catalog_id`는 ON DELETE SET NULL). 사용자의 덱 자체는 남는다.
   */
  DELETE_CATALOG: `DELETE FROM lyrics_catalog WHERE id = :catalog_id;`,
} as const;

export type ModerationStatement = keyof typeof MODERATION_SQL;
