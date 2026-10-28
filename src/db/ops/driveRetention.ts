import { FieldPath, type QueryDocumentSnapshot } from "@google-cloud/firestore";
import { OPS_ERRORS } from "#shared";
import type { Db } from "../client";
import {
  driveTombstonesCol,
  foldersCol,
  presentationsCol,
  type DriveTombstoneDoc,
} from "../collections";
import { deleteFolderTree } from "../queries/folders";
import { deletePresentation } from "../queries/presentations";

const DAY_MS = 24 * 60 * 60 * 1000;

const PAGE_SIZE = 300;

const FAILED_PRECONDITION = 9;

/** 휴지통에 넣은 지 이만큼(일)이 지난 폴더·프레젠테이션을 영구 삭제한다 */
export const DEFAULT_TRASH_RETENTION_DAYS = 90;

/**
 * 남긴 지 이만큼(일)이 지난 영구 삭제 기록을 지운다. 기록은 그동안 켜지 않은 기기가 지운 항목을 다시
 * 올리지 않게 막으므로(410, 부팅 병합의 영구 삭제), 휴지통보다 길게 둔다. 이보다 오래 꺼 둔 기기는
 * 지운 항목을 되살릴 수 있다.
 */
export const DEFAULT_TOMBSTONE_RETENTION_DAYS = 180;

/** 받는 가장 짧은 보관 기간(일). 잘못 적은 짧은 기간이 막 휴지통에 넣은 항목을 지우지 않게 한다 */
export const MIN_RETENTION_DAYS = 30;

export interface DriveRetentionOptions {
  /** 찾기만 하지 않고 지운다 */
  apply?: boolean;
  now?: Date;
  /** 휴지통 보관 기간(일). 기본 `DEFAULT_TRASH_RETENTION_DAYS` */
  trashDays?: number;
  /** 영구 삭제 기록 보관 기간(일). 기본 `DEFAULT_TOMBSTONE_RETENTION_DAYS` */
  tombstoneDays?: number;
}

/** 지울 폴더·프레젠테이션과 그 주인 */
export interface DriveRetentionItem {
  id: string;
  userId: string;
}

export interface DriveRetentionReport {
  /** 휴지통에 넣은 지 보관 기간이 지난 폴더. 하위 폴더·프레젠테이션과 함께 지운다 */
  folders: DriveRetentionItem[];
  /** 자신을 휴지통에 넣은 지 보관 기간이 지난 프레젠테이션. 담긴 폴더가 휴지통에 없어도 지운다 */
  presentations: DriveRetentionItem[];
  /** 남긴 지 보관 기간이 지난 영구 삭제 기록의 문서 id */
  tombstones: string[];
  /** 적용할 때 그사이 복원되거나 다시 쓰여 지우지 않은 항목·기록의 id */
  skipped: string[];
}

function cutoff(now: Date, days: number): Date {
  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS) {
    throw new Error(OPS_ERRORS.retention.daysTooShort(MIN_RETENTION_DAYS));
  }
  return new Date(now.getTime() - days * DAY_MS);
}

async function trashedBefore(
  collection: typeof foldersCol | typeof presentationsCol,
  db: Db,
  limit: Date,
): Promise<DriveRetentionItem[]> {
  const snapshot = await collection(db).where("trashedAt", "<", limit).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, userId: doc.data().userId }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function tombstonesWrittenBefore(
  db: Db,
  limit: Date,
): Promise<QueryDocumentSnapshot<DriveTombstoneDoc>[]> {
  const found: QueryDocumentSnapshot<DriveTombstoneDoc>[] = [];
  let last: QueryDocumentSnapshot<DriveTombstoneDoc> | undefined;
  for (;;) {
    const query = driveTombstonesCol(db)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    const page = await (last ? query.startAfter(last) : query).get();
    found.push(
      ...page.docs.filter((doc) => doc.updateTime.toMillis() < limit.getTime()),
    );
    last = page.docs.at(-1);
    if (page.size < PAGE_SIZE) return found;
  }
}

function isFailedPrecondition(error: unknown): boolean {
  return (error as { code?: number }).code === FAILED_PRECONDITION;
}

/**
 * 휴지통에 오래 둔 폴더·프레젠테이션을 영구 삭제하고, 오래된 영구 삭제 기록을 지운다. 기본은 미리보기라
 * 아무것도 쓰지 않는다. `scripts/driveRetention.mjs`가 쓴다.
 *
 * 부팅마다 받는 내 목록(휴지통 포함 프레젠테이션 머리, 영구 삭제 기록)이 쓰는 동안 끝없이 늘지 않게 한다.
 * 휴지통은 `trashedAt`이 보관 기간보다 이른 폴더와 프레젠테이션이다. 폴더는 하위 트리째, 프레젠테이션은
 * 하나씩 앱의 영구 삭제(`deleteFolderTree`, `deletePresentation`)로 지운다. 그래서 사본 곡·공유 멤버도
 * 함께 지우고, 지운 항목마다 영구 삭제 기록을 남겨 다른 기기가 부팅 병합에서 지운다. 그사이 휴지통에서
 * 꺼낸 항목은 그 확인이 거절해 지우지 않는다(`skipped`).
 *
 * 영구 삭제 기록은 문서를 마지막으로 쓴 시각(`updateTime`)이 보관 기간보다 이른 것만, 휴지통을 지우기
 * 전에 지운다. 찾은 뒤에 다시 쓰인 기록은 지우지 않는다(`lastUpdateTime` 전제 조건). 휴지통을 지우며 같은
 * 내용으로 다시 쓰는 기록은 시각이 바뀌지 않아 전제 조건으로 가려지지 않으므로, 먼저 지워 두어야 이번에
 * 지운 항목의 기록이 새로 남고 다른 기기가 그 삭제를 받는다.
 */
export async function pruneDriveRetention(
  db: Db,
  {
    apply = false,
    now = new Date(),
    trashDays = DEFAULT_TRASH_RETENTION_DAYS,
    tombstoneDays = DEFAULT_TOMBSTONE_RETENTION_DAYS,
  }: DriveRetentionOptions = {},
): Promise<DriveRetentionReport> {
  const trashLimit = cutoff(now, trashDays);
  const tombstoneLimit = cutoff(now, tombstoneDays);
  const [folders, presentations, tombstones] = await Promise.all([
    trashedBefore(foldersCol, db, trashLimit),
    trashedBefore(presentationsCol, db, trashLimit),
    tombstonesWrittenBefore(db, tombstoneLimit),
  ]);
  const report: DriveRetentionReport = {
    folders,
    presentations,
    tombstones: tombstones.map((doc) => doc.id),
    skipped: [],
  };
  if (!apply) return report;

  for (const tombstone of tombstones) {
    try {
      await tombstone.ref.delete({ lastUpdateTime: tombstone.updateTime });
    } catch (error) {
      if (!isFailedPrecondition(error)) throw error;
      report.skipped.push(tombstone.id);
    }
  }
  const deletedPresentations = new Set<string>();
  for (const folder of folders) {
    const result = await deleteFolderTree(db, folder.userId, folder.id);
    if (result.status === "deleted") {
      for (const id of result.presentationIds) deletedPresentations.add(id);
    } else if (result.status === "conflict") {
      report.skipped.push(folder.id);
    }
  }
  for (const presentation of presentations) {
    if (deletedPresentations.has(presentation.id)) continue;
    const result = await deletePresentation(
      db,
      presentation.id,
      presentation.userId,
    );
    if (result.status === "conflict") report.skipped.push(presentation.id);
  }
  return report;
}
