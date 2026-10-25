import type { Db } from "../client";
import { chunkIds, decksCol, reportsCol, type ReportDoc } from "../collections";
import { withDeckIndex } from "../deckIndex";

/**
 * 신고·게시 중단 운영 작업. 관리자 화면 없이 `scripts/moderation.mjs`로 실행한다.
 * 게시 중단은 곡을 비공개로 돌리고 다시 공개하지 못하게 막는다. 공개 범위와 검색 색인은
 * `withDeckIndex`가 함께 고친다.
 */

export interface PendingReport {
  id: string;
  deckId: string | null;
  reason: ReportDoc["reason"];
  details: string | null;
  reportedAt: string;
  targetTitle: string | null;
}

/** 처리 대기 신고 (접수 순) */
export async function listPendingReports(db: Db): Promise<PendingReport[]> {
  const snapshot = await reportsCol(db).where("status", "==", "pending").get();
  const reports = snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const deckIds = [
    ...new Set(reports.flatMap((r) => (r.deckId ? [r.deckId] : []))),
  ];
  const titles = new Map<string, string>();
  for (const ids of chunkIds(deckIds)) {
    const decks = await db.getAll(...ids.map((id) => decksCol(db).doc(id)));
    for (const deck of decks) {
      const data = deck.data();
      if (data) titles.set(deck.id, data.title as string);
    }
  }
  return reports.map((report) => ({
    id: report.id,
    deckId: report.deckId,
    reason: report.reason,
    details: report.details,
    reportedAt: report.createdAt.toISOString(),
    targetTitle: report.deckId ? (titles.get(report.deckId) ?? null) : null,
  }));
}

async function updateLibraryDeck(
  db: Db,
  deckId: string,
  change: { visibility?: "private"; takedownAt: Date | null },
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deckId);
    const deck = (await tx.get(ref)).data();
    if (!deck || deck.presentationId !== null) return false;
    tx.set(ref, withDeckIndex({ ...deck, ...change }));
    return true;
  });
}

/** 게시 중단: 비공개로 돌리고 공유 라이브러리·검색에서 뺀다. 소유자는 다시 공개할 수 없다 */
export async function takedownDeck(
  db: Db,
  deckId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return updateLibraryDeck(db, deckId, {
    visibility: "private",
    takedownAt: now,
  });
}

/** 게시 중단 해제. 비공개로 둔 채 소유자가 다시 공개할 수 있게만 한다 */
export async function restoreDeck(db: Db, deckId: string): Promise<boolean> {
  return updateLibraryDeck(db, deckId, { takedownAt: null });
}

/** 이 곡을 가져가 다시 공개한 곡들 (함께 게시 중단할지 판단용) */
export async function listPublicDescendants(
  db: Db,
  deckId: string,
): Promise<{ id: string; userId: string; title: string }[]> {
  const snapshot = await decksCol(db)
    .where("forkedFrom", "==", deckId)
    .where("listed", "==", true)
    .get();
  return snapshot.docs.map((doc) => {
    const { id, userId, title } = doc.data();
    return { id, userId, title };
  });
}

async function closeReports(
  db: Db,
  reportIds: readonly string[],
  status: "resolved" | "rejected",
  note: string,
  now: Date,
): Promise<number> {
  const batch = db.batch();
  for (const id of reportIds) {
    batch.update(reportsCol(db).doc(id), {
      status,
      resolvedAt: now,
      resolutionNote: note,
    });
  }
  if (reportIds.length > 0) await batch.commit();
  return reportIds.length;
}

/** 한 곡에 걸린 처리 대기 신고를 모두 처리 완료로 닫는다 */
export async function resolveReportsForTarget(
  db: Db,
  deckId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  const pending = await reportsCol(db)
    .where("deckId", "==", deckId)
    .where("status", "==", "pending")
    .get();
  return closeReports(
    db,
    pending.docs.map((doc) => doc.id),
    "resolved",
    note,
    now,
  );
}

/** 신고 하나를 처리 완료로 닫는다 */
export async function resolveReport(
  db: Db,
  reportId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  return closeReports(db, [reportId], "resolved", note, now);
}

/** 신고 하나를 기각한다 */
export async function rejectReport(
  db: Db,
  reportId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  return closeReports(db, [reportId], "rejected", note, now);
}
