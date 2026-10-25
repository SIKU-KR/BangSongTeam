import { createId, type CreateReportRequest } from "#shared";
import type { Db } from "../client";
import { decksCol, reportsCol } from "../collections";

export type CreateReportResult =
  | { status: "ok"; id: string }
  | { status: "not_found" }
  | { status: "duplicate" };

/**
 * 가사 오류·부적절 콘텐츠·저작권 신고와 교정 제안을 접수한다.
 *
 * 덱 신고는 공개 덱만 받는다. 비공개 덱 id로도 접수되면 '이 id의 덱이 있다'는
 * 사실이 새는 창구가 된다. 같은 사람이 같은 곡에 처리 대기 중인 신고를 또 낼 수
 * 없다. 확인과 접수가 한 트랜잭션이라 동시 요청에도 둘이 생기지 않는다. 처리는
 * `src/db/ops/moderation.ts`로 한다.
 */
export async function createReport(
  db: Db,
  userId: string,
  input: CreateReportRequest,
): Promise<CreateReportResult> {
  return db.runTransaction(async (tx) => {
    const [target, pending] = await Promise.all([
      tx.get(decksCol(db).doc(input.targetId)),
      tx.get(
        reportsCol(db)
          .where("reporterId", "==", userId)
          .where("deckId", "==", input.targetId)
          .where("status", "==", "pending")
          .limit(1),
      ),
    ]);
    if (!target.data()?.listed) return { status: "not_found" };
    if (!pending.empty) return { status: "duplicate" };

    const id = createId();
    tx.set(reportsCol(db).doc(id), {
      id,
      reporterId: userId,
      deckId: input.targetId,
      reason: input.reason,
      details: input.details?.trim() || null,
      status: "pending",
      resolvedAt: null,
      resolutionNote: null,
      createdAt: new Date(),
    });
    return { status: "ok", id };
  });
}
