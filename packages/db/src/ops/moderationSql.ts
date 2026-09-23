/**
 * 운영자 SQL (M5 신고·게시 중단).
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
  LIST_PENDING_REPORTS: `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, datetime(r.created_at, 'unixepoch') AS reported_at, d.title AS target_title FROM reports r LEFT JOIN decks d ON r.target_type = 'deck' AND d.id = r.target_id WHERE r.status = 'pending' ORDER BY r.created_at;`,

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
} as const;

export type ModerationStatement = keyof typeof MODERATION_SQL;
