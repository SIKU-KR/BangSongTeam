import type { DocumentReference, Transaction } from "@google-cloud/firestore";
import type { Db } from "../client";
import {
  chunkIds,
  decksCol,
  driveTombstonesCol,
  presentationMembersCol,
  type DriveTombstoneDoc,
} from "../collections";

/**
 * 프레젠테이션과 함께 지울 문서(담긴 사본 곡, 공유 멤버)를 트랜잭션 안에서 읽는다.
 * Firestore에는 외래키 cascade가 없어 프레젠테이션을 지우는 경로가 이것을 함께 지운다.
 */
export async function readPresentationDependents(
  tx: Transaction,
  db: Db,
  presentationIds: readonly string[],
): Promise<DocumentReference[]> {
  const snapshots = await Promise.all(
    chunkIds(presentationIds).flatMap((ids) => [
      tx.get(decksCol(db).where("presentationId", "in", ids)),
      tx.get(presentationMembersCol(db).where("presentationId", "in", ids)),
    ]),
  );
  return snapshots.flatMap((snapshot) =>
    snapshot.docs.map((doc) => doc.ref as DocumentReference),
  );
}

/** 영구 삭제 기록을 남긴다 (다른 기기의 부팅 병합용) */
export function writeTombstones(
  tx: Transaction,
  db: Db,
  userId: string,
  kind: DriveTombstoneDoc["kind"],
  ids: readonly string[],
): void {
  for (const itemId of ids) {
    tx.set(driveTombstonesCol(db).doc(itemId), { itemId, userId, kind });
  }
}

/**
 * 같은 id를 다시 저장하면 영구 삭제 기록을 지운다. 남의 기록은 건드리지 않도록 읽고
 * 지우므로, 트랜잭션의 다른 읽기와 함께 먼저 부르고 돌려받은 함수를 쓰기 단계에서 부른다.
 */
export async function prepareClearTombstone(
  tx: Transaction,
  db: Db,
  userId: string,
  itemId: string,
): Promise<() => void> {
  const ref = driveTombstonesCol(db).doc(itemId);
  const tombstone = (await tx.get(ref)).data();
  return () => {
    if (tombstone?.userId === userId) tx.delete(ref);
  };
}
