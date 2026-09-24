import { and, eq } from "drizzle-orm";
import { createId, type CreateReportRequest } from "@repo/shared";
import { decks, reports } from "../schema";
import { publicDeckCondition } from "./publicScope";

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
 * 사실이 새는 창구가 된다. 처리는 운영 런북(`docs/ops/moderation-runbook.md`)이 한다.
 */
export async function createReport(
  db: DbInstance,
  userId: string,
  input: CreateReportRequest,
): Promise<CreateReportResult> {
  const [target] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, input.targetId), publicDeckCondition()));
  if (!target) return { status: "not_found" };

  const [pending] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.userId, userId),
        eq(reports.targetType, input.targetType),
        eq(reports.targetId, input.targetId),
        eq(reports.status, "pending"),
      ),
    );
  if (pending) return { status: "duplicate" };

  const id = createId();
  await db.insert(reports).values({
    id,
    userId,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    details: input.details?.trim() || null,
    status: "pending",
  });
  return { status: "ok", id };
}
