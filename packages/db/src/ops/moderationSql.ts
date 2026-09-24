/**
 * 관리자 화면 없이 wrangler d1 execute로 실행하는 운영 SQL 문장 정의.
 * docs/ops/moderation-runbook.md 및 moderationSql.test.ts와 동기화된다.
 */
export const MODERATION_SQL = {
  LIST_PENDING_REPORTS: `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, datetime(r.created_at, 'unixepoch') AS reported_at, d.title AS target_title FROM reports r LEFT JOIN decks d ON r.target_type = 'deck' AND d.id = r.target_id WHERE r.status = 'pending' ORDER BY r.created_at;`,

  TAKEDOWN_DECK: `UPDATE decks SET visibility = 'private', takedown_at = unixepoch() WHERE id = :deck_id AND scope = 'library';`,

  RESTORE_DECK: `UPDATE decks SET takedown_at = NULL WHERE id = :deck_id AND scope = 'library';`,

  LIST_PUBLIC_DESCENDANTS: `SELECT id, user_id, title, datetime(published_at, 'unixepoch') AS published FROM decks WHERE forked_from = :deck_id AND scope = 'library' AND visibility = 'public' AND takedown_at IS NULL;`,

  RESOLVE_REPORTS_FOR_TARGET: `UPDATE reports SET status = 'resolved', resolved_at = unixepoch(), resolution_note = :note WHERE target_id = :target_id AND status = 'pending';`,

  RESOLVE_REPORT: `UPDATE reports SET status = 'resolved', resolved_at = unixepoch(), resolution_note = :note WHERE id = :report_id;`,

  REJECT_REPORT: `UPDATE reports SET status = 'rejected', resolved_at = unixepoch(), resolution_note = :note WHERE id = :report_id;`,
} as const;

export type ModerationStatement = keyof typeof MODERATION_SQL;
