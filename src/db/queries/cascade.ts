import type { DocumentReference, Transaction } from "@google-cloud/firestore";
import type { Db } from "../client";
import {
  chunkIds,
  decksCol,
  driveTombstonesCol,
  foldersCol,
  presentationMembersCol,
  presentationsCol,
  type DriveTombstoneDoc,
} from "../collections";

/**
 * 영구 삭제 트랜잭션 하나에 담는 쓰기 수 상한.
 *
 * 커밋 하나를 작고 짧게 두려고 Firestore의 예전 쓰기 한도(500)보다 낮게 잡는다. 지금 할당량 문서는
 * 쓰기 수 대신 요청 크기(10 MiB)와 트랜잭션 시간(270초)을 적는다. 에뮬레이터는 어느 것도 검사하지
 * 않으므로 테스트가 쓰기 수를 센다(`instrumentTransactions`).
 * https://firebase.google.com/docs/firestore/quotas#writes_and_transactions
 */
export const MAX_WRITES_PER_TRANSACTION = 450;

/**
 * 영구 삭제 한 건이 여는 트랜잭션 수 상한(쓰기로 9만 건쯤). 계획이 잘못돼 차례가 끝나지 않아도
 * 요청 시간이 다할 때까지 돌지 않고 오류로 멈춘다.
 */
export const MAX_DELETION_PASSES = 200;

const DELETE_AND_TOMBSTONE = 2;

/**
 * 영구 삭제를 거절한 결과.
 *
 * - `notFound`: 없거나 남의 항목 (→ 404).
 * - `conflict`: 서버에서 그 항목이 휴지통에 없거나(다른 기기에서 복원했거나 밖으로 옮김), 지우라고
 *   한 기기가 보지 못한 항목이 서버 트리에 있다 (→ 409). `partial`은 앞선 차례가 이미 일부를
 *   지웠는지다.
 */
export type DeleteForeverRefusal =
  { status: "notFound" } | { status: "conflict"; partial: boolean };

/** 영구 삭제 결과. 지운 id는 이 요청이 지운 것만 담는다 */
export type DeletionResult =
  | { status: "deleted"; folderIds: string[]; presentationIds: string[] }
  | DeleteForeverRefusal;

/** 쓰기 단계에 할 쓰기. 트랜잭션의 읽기를 모두 마친 뒤 `write`를 부른다 */
export interface PreparedWrites {
  writes: number;
  write: () => void;
}

/** 영구 삭제 한 차례(트랜잭션 하나)에 지울 것 */
export interface DeletionPass extends PreparedWrites {
  presentationIds: string[];
  folderIds: string[];
  /** 이 차례를 쓰면 지우라고 한 것이 모두 지워진다 */
  done: boolean;
}

export interface TombstoneEntry {
  kind: DriveTombstoneDoc["kind"];
  itemId: string;
}

async function readDependentsByPresentation(
  tx: Transaction,
  db: Db,
  presentationIds: readonly string[],
): Promise<Map<string, DocumentReference[]>> {
  const [members, copies] = await Promise.all([
    tx.get(
      presentationMembersCol(db).where("presentationId", "in", presentationIds),
    ),
    tx.get(decksCol(db).where("presentationId", "in", presentationIds)),
  ]);
  const dependents = new Map(
    presentationIds.map((id): [string, DocumentReference[]] => [id, []]),
  );
  for (const doc of members.docs) {
    dependents
      .get(doc.data().presentationId)
      ?.push(doc.ref as DocumentReference);
  }
  for (const doc of copies.docs) {
    dependents
      .get(doc.data().presentationId ?? "")
      ?.push(doc.ref as DocumentReference);
  }
  return dependents;
}

/**
 * 영구 삭제 기록(다른 기기의 부팅 병합용)을 쓸 준비를 한다. 트랜잭션의 다른 읽기와 함께 먼저
 * 부르고, 돌려받은 `write`를 쓰기 단계에서 부른다.
 *
 * 기록 문서 id는 항목 id라 모든 사용자가 한 id 공간을 쓴다. 그래서 기록이 없거나 내 기록일 때만
 * 쓴다. 남의 기록을 덮으면 그 사람의 다른 기기가 영구 삭제한 항목을 다시 올린다. 남이 같은 id로
 * 먼저 기록을 차지하는 길은 `upsertFolder`가 막는다(새 폴더 id가 프레젠테이션 id면 거절). 같은 id가
 * 두 번 오면 처음 것만 쓴다.
 */
export async function prepareTombstones(
  tx: Transaction,
  db: Db,
  userId: string,
  entries: readonly TombstoneEntry[],
): Promise<PreparedWrites> {
  const byId = new Map<string, TombstoneEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.itemId)) byId.set(entry.itemId, entry);
  }
  if (byId.size === 0) return { writes: 0, write: () => {} };

  const snapshots = await tx.getAll(
    ...[...byId.keys()].map((id) => driveTombstonesCol(db).doc(id)),
  );
  const writable = snapshots.flatMap((snapshot) => {
    const entry = byId.get(snapshot.id);
    const owner = snapshot.data()?.userId;
    return entry && (owner === undefined || owner === userId) ? [entry] : [];
  });
  return {
    writes: writable.length,
    write: () => {
      for (const { kind, itemId } of writable) {
        tx.set(driveTombstonesCol(db).doc(itemId), { itemId, userId, kind });
      }
    },
  };
}

/**
 * 영구 삭제 한 차례를 쓰기 `MAX_WRITES_PER_TRANSACTION`건 안으로 계획한다. 읽기를 모두 이 안에서
 * 하므로 트랜잭션의 다른 읽기를 마친 뒤 부르고, 돌려받은 `write`를 쓰기 단계에서 부른다.
 *
 * 차례가 커밋된 뒤 다음 차례 전에 멈춰도 남은 것은 모두 휴지통에 넣은 폴더 아래에 그대로 있어,
 * 다시 지우면 이어서 끝난다. 그래서 다음 순서로 담는다.
 * - 프레젠테이션마다 공유 멤버, 사본 곡, 프레젠테이션과 그 영구 삭제 기록을 한 묶음으로 담는다.
 *   첫 묶음이 혼자서도 넘치면 멤버부터 담을 수 있는 만큼만 지우고 프레젠테이션은 다음 차례에
 *   지운다. 곡보다 멤버가 먼저 사라져야 중간에 멈췄을 때 잃는 것이 적다.
 * - 폴더는 남은 프레젠테이션을 이 차례에 모두 담았을 때만, 주어진 순서(깊은 폴더부터, 지우려는
 *   폴더가 마지막)대로 영구 삭제 기록과 함께 담는다. 폴더가 먼저 사라지면 그 안의 프레젠테이션이나
 *   하위 폴더가 루트로 올라와 휴지통 밖에 다시 보인다.
 * - 영구 삭제 기록은 `prepareTombstones`처럼 남의 기록을 덮지 않는다.
 *
 * 프레젠테이션의 멤버·사본은 `in` 조건 한도(30)씩 나눠, 차례가 찰 때까지만 읽는다.
 */
export async function prepareDeletionPass(
  tx: Transaction,
  db: Db,
  userId: string,
  presentationIds: readonly string[],
  folderIdsChildFirst: readonly string[],
): Promise<DeletionPass> {
  const deletes: DocumentReference[] = [];
  const passPresentationIds: string[] = [];
  let budget = MAX_WRITES_PER_TRANSACTION;

  planning: for (const ids of chunkIds(presentationIds)) {
    if (budget < DELETE_AND_TOMBSTONE) break;
    const dependents = await readDependentsByPresentation(tx, db, ids);
    for (const id of ids) {
      const refs = dependents.get(id) ?? [];
      const unitWrites = refs.length + DELETE_AND_TOMBSTONE;
      if (unitWrites > budget) {
        if (deletes.length === 0) deletes.push(...refs.slice(0, budget));
        break planning;
      }
      deletes.push(...refs, presentationsCol(db).doc(id));
      passPresentationIds.push(id);
      budget -= unitWrites;
    }
  }

  const allPresentationsInPass =
    passPresentationIds.length === presentationIds.length;
  const passFolderIds = allPresentationsInPass
    ? folderIdsChildFirst.slice(0, Math.floor(budget / DELETE_AND_TOMBSTONE))
    : [];
  const tombstones = await prepareTombstones(tx, db, userId, [
    ...passPresentationIds.map((itemId) => ({
      kind: "presentation" as const,
      itemId,
    })),
    ...passFolderIds.map((itemId) => ({ kind: "folder" as const, itemId })),
  ]);
  const folderRefs = passFolderIds.map((id) => foldersCol(db).doc(id));

  return {
    presentationIds: passPresentationIds,
    folderIds: passFolderIds,
    done:
      allPresentationsInPass &&
      passFolderIds.length === folderIdsChildFirst.length,
    writes: deletes.length + folderRefs.length + tombstones.writes,
    write: () => {
      for (const ref of [...deletes, ...folderRefs]) tx.delete(ref);
      tombstones.write();
    },
  };
}

/**
 * 영구 삭제를 여러 트랜잭션(차례)으로 나눠 끝까지 지운다.
 *
 * `preparePass`는 차례마다 트리를 다시 읽고 확인(없음·휴지통·기기가 본 항목)을 되풀이한 뒤
 * `prepareDeletionPass`로 그 차례에 지울 것을 고른다. 확인과 쓰기가 같은 트랜잭션이라 그 사이에
 * 끼어든 복원·이동을 놓치지 않는다. 지운 id는 트랜잭션이 돌려준 값으로 트랜잭션 밖에서 모은다.
 * Firestore는 경합이 나면 콜백을 다시 돌리므로, 안에서 모으면 같은 id를 두 번 센다.
 *
 * 앞 차례가 지운 뒤 항목이 없어졌으면 같은 삭제를 다시 보낸 요청이 마저 지운 것이라 지운 것으로
 * 답한다. 앞 차례가 지운 뒤 거절되면 일부만 지운 거절(`partial`)이다. 아무것도 쓰지 않고 끝나지도
 * 않는 차례(계획이 잘못됨)나 `MAX_DELETION_PASSES`를 넘는 삭제는 오류를 던진다(500).
 */
export async function runDeletionPasses(
  db: Db,
  preparePass: (
    tx: Transaction,
  ) => Promise<DeletionPass | "notFound" | "conflict">,
): Promise<DeletionResult> {
  const folderIds: string[] = [];
  const presentationIds: string[] = [];

  for (let pass = 0; pass < MAX_DELETION_PASSES; pass += 1) {
    const outcome = await db.runTransaction(async (tx) => {
      const prepared = await preparePass(tx);
      if (typeof prepared === "string") return prepared;
      prepared.write();
      return {
        folderIds: prepared.folderIds,
        presentationIds: prepared.presentationIds,
        writes: prepared.writes,
        done: prepared.done,
      };
    });

    if (outcome === "notFound") {
      return pass === 0
        ? { status: "notFound" }
        : { status: "deleted", folderIds, presentationIds };
    }
    if (outcome === "conflict")
      return { status: "conflict", partial: pass > 0 };

    folderIds.push(...outcome.folderIds);
    presentationIds.push(...outcome.presentationIds);
    if (outcome.done) return { status: "deleted", folderIds, presentationIds };
    if (outcome.writes === 0) {
      throw new Error("permanent delete pass wrote nothing");
    }
  }
  throw new Error(
    `permanent delete needed more than ${MAX_DELETION_PASSES} passes`,
  );
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
