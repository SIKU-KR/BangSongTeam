import { eq } from "drizzle-orm";
import { createId, type CreateReportRequest } from "#shared";
import { publicDecks, reports } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export type CreateReportResult =
  | { status: "ok"; id: string }
  | { status: "not_found" }
  | { status: "duplicate" };

/**
 * 가사 오류·부적절 콘텐츠·저작권 신고와 교정 제안을 접수한다.
 *
 * 덱 신고는 공개 덱만 받는다. 비공개 덱 id로도 접수되면 '이 id의 덱이 있다'는
 * 사실이 새는 창구가 된다. 같은 사람이 같은 곡에 처리 대기 중인 신고를 또 낼 수
 * 없다 (부분 유일 인덱스 `idx_reports_pending`). 처리는
 * `src/db/ops/moderationSql.ts`의 운영 SQL로 한다.
 */
export async function createReport(
  db: DbInstance,
  userId: string,
  input: CreateReportRequest,
): Promise<CreateReportResult> {
  const [target] = await db
    .select({ id: publicDecks.id })
    .from(publicDecks)
    .where(eq(publicDecks.id, input.targetId));
  if (!target) return { status: "not_found" };

  const id = createId();
  const inserted: { id: string }[] = await db
    .insert(reports)
    .values({
      id,
      reporterId: userId,
      deckId: input.targetId,
      reason: input.reason,
      details: input.details?.trim() || null,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  return inserted.length > 0 ? { status: "ok", id } : { status: "duplicate" };
}
