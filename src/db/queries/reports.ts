import {
  createId,
  isReservedDocumentId,
  type CreateReportRequest,
} from "#shared";
import type { Db } from "../client";
import { decksCol, reportsCol } from "../collections";
import { readLibraryLimits } from "./limits";

export type CreateReportResult =
  | { status: "ok"; id: string }
  | { status: "not_found" }
  | { status: "duplicate" }
  | { status: "banned" }
  | { status: "rate_limited" };

/**
 * 가사 오류·부적절 콘텐츠·저작권 신고와 교정 제안을 접수한다.
 *
 * 덱 신고는 공개 덱만 받는다. 비공개 덱 id로도 접수되면 '이 id의 덱이 있다'는
 * 사실이 새는 창구가 된다. 같은 사람이 같은 곡에 처리 대기 중인 신고를 또 낼 수
 * 없다. 확인과 접수가 한 트랜잭션이라 동시 요청에도 둘이 생기지 않는다. 처리는
 * `src/db/ops/moderation.ts`로 한다.
 *
 * 신고에는 그때의 곡 주인과 제목을 함께 남긴다. 주인이 곡을 지워 `deckId`가 비어도 운영자가 누구의
 * 무슨 곡이었는지 알 수 있다. 운영자가 제한한 계정의 신고는 받지 않고(`banned`), 그날 신고 한도
 * (`DAILY_USER_LIMITS.report`)를 다 썼으면 `rate_limited`다. 받은 신고만 센다.
 */
export async function createReport(
  db: Db,
  userId: string,
  input: CreateReportRequest,
  now: Date = new Date(),
): Promise<CreateReportResult> {
  if (isReservedDocumentId(input.targetId)) return { status: "not_found" };
  return db.runTransaction(async (tx) => {
    const [target, pending, limits] = await Promise.all([
      tx.get(decksCol(db).doc(input.targetId)).then((s) => s.data()),
      tx.get(
        reportsCol(db)
          .where("reporterId", "==", userId)
          .where("deckId", "==", input.targetId)
          .where("status", "==", "pending")
          .limit(1),
      ),
      readLibraryLimits(tx, db, userId, "report", now),
    ]);
    if (limits.banned) return { status: "banned" };
    if (!target?.listed) return { status: "not_found" };
    if (!pending.empty) return { status: "duplicate" };
    if (limits.quota.exceeded) return { status: "rate_limited" };

    const id = createId();
    tx.set(reportsCol(db).doc(id), {
      id,
      reporterId: userId,
      deckId: input.targetId,
      targetUserId: target.userId,
      targetTitle: target.title,
      reason: input.reason,
      details: input.details?.trim() || null,
      status: "pending",
      resolvedAt: null,
      resolutionNote: null,
      createdAt: now,
    });
    limits.quota.take();
    return { status: "ok", id };
  });
}
