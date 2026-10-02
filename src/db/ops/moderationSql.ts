/**
 * 관리자 화면 없이 wrangler d1 execute로 실행하는 운영 SQL 문장 정의.
 * 시각 컬럼은 밀리초라 사람이 읽을 때는 1000으로 나눠 `datetime`에 넘긴다.
 */
export const MODERATION_SQL = {
  LIST_PENDING_REPORTS: `SELECT r.id, r.deck_id, r.reason, r.details, datetime(r.created_at / 1000, 'unixepoch') AS reported_at, d.title AS target_title FROM reports r LEFT JOIN decks d ON d.id = r.deck_id WHERE r.status = 'pending' ORDER BY r.created_at;`,

  TAKEDOWN_DECK: `UPDATE decks SET visibility = 'private', taken_down_at = unixepoch() * 1000 WHERE id = :deck_id AND presentation_id IS NULL;`,

  RESTORE_DECK: `UPDATE decks SET taken_down_at = NULL WHERE id = :deck_id AND presentation_id IS NULL;`,

  LIST_PUBLIC_DESCENDANTS: `SELECT id, user_id, title, datetime(published_at / 1000, 'unixepoch') AS published FROM public_decks WHERE forked_from = :deck_id;`,

  RESOLVE_REPORTS_FOR_TARGET: `UPDATE reports SET status = 'resolved', resolved_at = unixepoch() * 1000, resolution_note = :note WHERE deck_id = :deck_id AND status = 'pending';`,

  RESOLVE_REPORT: `UPDATE reports SET status = 'resolved', resolved_at = unixepoch() * 1000, resolution_note = :note WHERE id = :report_id;`,

  REJECT_REPORT: `UPDATE reports SET status = 'rejected', resolved_at = unixepoch() * 1000, resolution_note = :note WHERE id = :report_id;`,
} as const;
