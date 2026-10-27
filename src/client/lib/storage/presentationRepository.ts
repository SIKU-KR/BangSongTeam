import type { z } from "zod";
import type { IDBPDatabase, IDBPObjectStore } from "idb";
import {
  PresentationSchema,
  fitPresentationToLimits,
  type Presentation,
} from "#shared";
import { getOfflineDB, type WorshipOfflineDB } from "./db";

/**
 * 읽지 못한 저장본. 지우지 않고 그대로 두어 복구할 길을 남긴다. 프레젠테이션은 덮기 전에 보관한
 * 사본(`<id>#kept#<updatedAt>`)을 아직 읽지 못해도 원래 프레젠테이션 id로 알린다.
 */
export interface CorruptedRecord {
  id: string;
}

export interface LoadResult<T> {
  valid: T[];
  corrupted: CorruptedRecord[];
}

/** 프레젠테이션 저장본 전체를 읽은 결과. `repairedIds`는 글 한도에 맞춰 줄여 읽은 저장본의 id다 */
export interface PresentationLoadResult extends LoadResult<Presentation> {
  repairedIds: string[];
}

/**
 * 저장본 한 건을 읽은 결과. 없는 저장본(`missing`)과 읽지 못한 저장본(`unreadable`)을 가른다.
 *
 * 읽지 못한 저장본은 깨졌거나 이 버전이 모르는 모양(새 버전의 탭이 쓴 것)이라 지워진 것이 아니다.
 * 없는 것으로 보면 다른 탭의 알림을 받은 탭이 멀쩡한 항목을 메모리에서 지운다.
 */
export type LoadedRecord<T> =
  | { status: "missing" }
  | { status: "unreadable" }
  | { status: "ok"; value: T };

/** 저장소에서 꺼낸 행 하나를 스키마로 읽는다 (`LoadedRecord`) */
export function toLoadedRecord<T>(
  row: unknown,
  schema: z.ZodType<T>,
): LoadedRecord<T> {
  if (row === undefined) return { status: "missing" };
  const parsed = schema.safeParse(row);
  return parsed.success
    ? { status: "ok", value: parsed.data }
    : { status: "unreadable" };
}

/** 검증에 실패한 행에서 알아볼 수 있는 id만 꺼낸다. id조차 없으면 `(unknown)` */
export function toCorruptedRecord(row: unknown): CorruptedRecord {
  const id =
    typeof row === "object" && row !== null && "id" in row ? row.id : null;
  return { id: typeof id === "string" ? id : "(unknown)" };
}

type OfflineDB = IDBPDatabase<WorshipOfflineDB>;
type PresentationStore = IDBPObjectStore<
  WorshipOfflineDB,
  ["presentations"],
  "presentations",
  "readwrite"
>;
type UnknownRecord = Record<string, unknown>;

interface ReadPresentation {
  presentation: Presentation;
  repaired: boolean;
}

interface HealedRow {
  row: unknown;
  keptRemain: boolean;
}

const KEPT_COPY_MARK = "#kept#";
const KEPT_COPY_KEY = /^([A-Za-z0-9_-]{21})#kept#/;

let unreadableAtLoad = new Set<string>();

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keptKey(id: string, updatedAt: unknown): string {
  const version = typeof updatedAt === "string" ? updatedAt : "unknown";
  return `${id}${KEPT_COPY_MARK}${version}`;
}

function keptRange(id: string): IDBKeyRange {
  const prefix = `${id}${KEPT_COPY_MARK}`;
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

function keptCopyOwner(row: unknown): string | null {
  if (!isRecord(row) || typeof row.id !== "string") return null;
  return KEPT_COPY_KEY.exec(row.id)?.[1] ?? null;
}

function readPresentation(row: unknown): ReadPresentation | null {
  const strict = PresentationSchema.safeParse(row);
  if (strict.success) return { presentation: strict.data, repaired: false };
  const fitted = PresentationSchema.safeParse(fitPresentationToLimits(row));
  return fitted.success ? { presentation: fitted.data, repaired: true } : null;
}

function isNewer(candidate: Presentation, current: Presentation): boolean {
  return Date.parse(candidate.updatedAt) > Date.parse(current.updatedAt);
}

async function keepUnreadableRow(
  store: PresentationStore,
  stored: unknown,
  next: Presentation,
): Promise<void> {
  if (!unreadableAtLoad.has(next.id) || !isRecord(stored)) return;
  if (PresentationSchema.safeParse(stored).success) return;
  if (String(stored.updatedAt) === next.updatedAt) return;
  const key = keptKey(next.id, stored.updatedAt);
  if ((await store.getKey(key)) !== undefined) return;
  await store.put({ ...stored, id: key } as Presentation);
}

/**
 * 프레젠테이션 문서 1건을 전체 교체(put)한다.
 * 부분 갱신을 쓰지 않는 이유: 마지막 쓰기가 유실돼도 직전 저장본이 온전히 남아야 한다.
 *
 * 저장본을 실을 때 읽지 못한 자리(`loadAllPresentations`·`loadPresentation`)를 덮으면, 같은
 * readwrite 트랜잭션에서 덮기 직전의 행을 `<id>#kept#<updatedAt>`에 먼저 보관한다. 부팅 병합과
 * 저장 줄은 id로만 쓰므로, 이 버전이 읽지 못한 새 버전의 판이나 깨진 판을 서버 사본으로 덮으면
 * 그 판이 영영 사라진다. 보관한 판은 덮지 않고, 저장할 판과 같은 `updatedAt`의 판은 같은 판이라
 * 보관하지 않는다. 보관과 덮기는 함께 성공하거나 함께 실패한다.
 *
 * 저장 실패(QuotaExceededError 등)는 삼키지 않고 호출자에게 전파한다.
 */
export async function savePresentation(
  presentation: Presentation,
): Promise<void> {
  const db = await getOfflineDB();
  if (!unreadableAtLoad.has(presentation.id)) {
    await db.put("presentations", presentation);
    return;
  }
  const tx = db.transaction("presentations", "readwrite");
  const write = (async (): Promise<void> => {
    const stored: unknown = await tx.store.get(presentation.id);
    await keepUnreadableRow(tx.store, stored, presentation);
    await tx.store.put(presentation);
  })();
  await Promise.all([write, tx.done]);
  unreadableAtLoad.delete(presentation.id);
}

/**
 * 저장본의 `updatedAt`이 `presentation`과 같을 때만 쓰고, 썼으면 true다(compare-and-set).
 * 공유받은 사본은 그 자리에 소유자 자신의 저장본이 있으면 쓰지 않는다(`saveSharedPresentation`).
 *
 * 저장본을 실으며 고친 판(글 한도로 줄인 판, 중복 덱 id를 고친 판)을 다시 쓸 때 쓴다. 읽은 뒤
 * 다른 탭(이전 버전의 탭 포함)이 그 저장본을 고쳐 썼으면, 고친 옛 판으로 그 편집을 덮지 않는다.
 * 읽기와 쓰기를 한 readwrite 트랜잭션에서 한다.
 */
export async function savePresentationIfUnchanged(
  presentation: Presentation,
): Promise<boolean> {
  const db = await getOfflineDB();
  const tx = db.transaction("presentations", "readwrite");
  const write = (async (): Promise<boolean> => {
    const stored: unknown = await tx.store.get(presentation.id);
    if (!isRecord(stored) || stored.updatedAt !== presentation.updatedAt) {
      return false;
    }
    if (presentation.access && !stored.access) return false;
    await tx.store.put(presentation);
    return true;
  })();
  const [written] = await Promise.all([write, tx.done]);
  return written;
}

async function healKeptCopies(db: OfflineDB, id: string): Promise<HealedRow> {
  const tx = db.transaction("presentations", "readwrite");
  const heal = (async (): Promise<HealedRow> => {
    const stored: unknown = await tx.store.get(id);
    const keys = await tx.store.getAllKeys(keptRange(id));
    const copies: unknown[] = await tx.store.getAll(keptRange(id));
    if (stored === undefined) {
      await tx.store.delete(keptRange(id));
      return { row: undefined, keptRemain: false };
    }
    const current = readPresentation(stored);
    if (!current) return { row: stored, keptRemain: keys.length > 0 };

    let newest = current.presentation;
    let keptRemain = false;
    for (const [index, key] of keys.entries()) {
      const copy = copies[index];
      const read = isRecord(copy) ? readPresentation({ ...copy, id }) : null;
      if (!read) {
        keptRemain = true;
        continue;
      }
      await tx.store.delete(key);
      if (read.presentation.access && !current.presentation.access) continue;
      if (isNewer(read.presentation, newest)) newest = read.presentation;
    }
    if (newest === current.presentation) return { row: stored, keptRemain };
    await tx.store.put(newest);
    return { row: newest, keptRemain };
  })();
  const [healed] = await Promise.all([heal, tx.done]);
  return healed;
}

function replaceRow(rows: unknown[], id: string, row: unknown): void {
  const index = rows.findIndex(
    (candidate) => isRecord(candidate) && candidate.id === id,
  );
  if (row === undefined) {
    if (index >= 0) rows.splice(index, 1);
  } else if (index >= 0) {
    rows[index] = row;
  } else {
    rows.push(row);
  }
}

/**
 * 프레젠테이션 저장본을 모두 읽는다. 항목별로 검증해 한 건이 깨져도 나머지는 살린다.
 *
 * - 글 한도만 넘은 저장본(이전 버전이 저장한 100자 넘는 제목 등)은 줄여서 읽고 `repairedIds`로
 *   알린다. 저장본은 고쳐 쓰지 않는다. 다시 쓰기는 부른 쪽이 `savePresentationIfUnchanged`로 한다.
 * - 그래도 읽지 못한 저장본은 그 자리에 두고 알리며, 이 탭이 덮을 때 보관하도록 기억한다
 *   (`savePresentation`).
 * - 보관한 사본(`<id>#kept#<updatedAt>`)은 원래 id마다 한 readwrite 트랜잭션에서 지금 저장본과
 *   함께 다시 읽어 고친다. 지금 저장본이 없으면 그 프레젠테이션이 지워진 것이라 보관본도 지운다.
 *   지금 저장본을 읽지 못하면 모두 그대로 둔다. 그 밖에는 읽을 수 있게 된 보관본 가운데 가장
 *   새 판이 지금 판보다 새로우면 그 판을 되살리고, 읽은 보관본은 지운다. 부팅 병합이 로컬과
 *   서버 사본을 고르는 것과 같은 나중 쓰기 우선이다. 다만 공유받은 사본은 소유자 자신의 저장본
 *   자리에 되살리지 않는다(`saveSharedPresentation`). 아직 읽지 못한 보관본은 남기고 원래 id로
 *   한 번만 알린다. 고치지 못하면(트랜잭션 실패) 보관본을 그대로 두고 알린다.
 *
 * 보관본 고치기 말고는 쓰지 않는다.
 */
export async function loadAllPresentations(): Promise<PresentationLoadResult> {
  const db = await getOfflineDB();
  const snapshot: unknown[] = await db.getAll("presentations");

  const rows: unknown[] = [];
  const keptOwners = new Set<string>();
  for (const row of snapshot) {
    const owner = keptCopyOwner(row);
    if (owner) keptOwners.add(owner);
    else rows.push(row);
  }

  const keptUnread = new Set<string>();
  for (const id of keptOwners) {
    try {
      const healed = await healKeptCopies(db, id);
      replaceRow(rows, id, healed.row);
      if (healed.keptRemain) keptUnread.add(id);
    } catch {
      keptUnread.add(id);
    }
  }

  const valid: Presentation[] = [];
  const corrupted: CorruptedRecord[] = [];
  const repairedIds: string[] = [];
  const unreadable = new Set<string>();
  for (const row of rows) {
    const read = readPresentation(row);
    if (read) {
      valid.push(read.presentation);
      if (read.repaired) repairedIds.push(read.presentation.id);
      continue;
    }
    corrupted.push(toCorruptedRecord(row));
    if (isRecord(row) && typeof row.id === "string") unreadable.add(row.id);
  }
  for (const id of keptUnread) {
    if (!corrupted.some((record) => record.id === id)) corrupted.push({ id });
  }
  unreadableAtLoad = unreadable;

  return { valid, corrupted, repairedIds };
}

/**
 * 프레젠테이션 저장본 한 건을 읽는다. 다른 탭이 쓰거나 지운 저장본을 다시 읽을 때 쓴다.
 *
 * 스키마에 없는 필드는 떼고 읽는다. 새 버전의 탭이 남긴 필드를 이 버전이 들고 있다가 다시 쓰거나
 * 올리면, 그 값이 앞으로 나아가지 않은 채 남는다. 글 한도만 넘은 저장본은 줄여서 읽는다. 읽지
 * 못한 저장본은 이 탭이 덮을 때 보관하도록 기억한다(`savePresentation`).
 */
export async function loadPresentation(
  id: string,
): Promise<LoadedRecord<Presentation>> {
  const db = await getOfflineDB();
  const row: unknown = await db.get("presentations", id);
  if (row === undefined) return { status: "missing" };
  const read = readPresentation(row);
  if (read) return { status: "ok", value: read.presentation };
  unreadableAtLoad.add(id);
  return { status: "unreadable" };
}

/**
 * 임베드된 덱도 문서와 함께 사라진다. 덮기 전에 보관한 사본(`<id>#kept#…`)도 같은 트랜잭션에서
 * 지운다. 지운 프레젠테이션의 보관본은 되살릴 곳이 없다.
 */
export async function deletePresentation(id: string): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("presentations", "readwrite");
  await Promise.all([
    tx.store.delete(id),
    tx.store.delete(keptRange(id)),
    tx.done,
  ]);
  unreadableAtLoad.delete(id);
}

/**
 * 링크로 공유받은 프레젠테이션(`access`가 있는 사본)을 저장한다. 같은 id 자리에 소유자 자신의
 * 저장본이 있으면 쓰지 않는다.
 *
 * 저장소는 id 하나로만 저장본을 가르므로, 한 브라우저를 소유자와 공유받은 사람이 함께 쓰면 두
 * 사람의 사본이 한 자리를 나눠 쓴다. 공유받은 사본이 덮으면 소유자가 아직 올리지 못한 편집이
 * 사라지고, 소유자는 자기 프레젠테이션을 보기 전용으로 읽게 된다. 읽기와 쓰기를 한 readwrite
 * 트랜잭션에서 해, 그사이 소유자의 탭이 쓴 저장본도 덮지 않는다. 저장소 버전을 올리지 않아
 * 같은 저장소를 여는 이전 버전의 탭도 그대로 열린다. 읽지 못한 공유 사본을 덮을 때는
 * `savePresentation`처럼 먼저 보관한다.
 */
export async function saveSharedPresentation(
  presentation: Presentation,
): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("presentations", "readwrite");
  const write = (async (): Promise<boolean> => {
    const stored: unknown = await tx.store.get(presentation.id);
    if (isRecord(stored) && !stored.access) return false;
    await keepUnreadableRow(tx.store, stored, presentation);
    await tx.store.put(presentation);
    return true;
  })();
  const [written] = await Promise.all([write, tx.done]);
  if (written) unreadableAtLoad.delete(presentation.id);
}

/**
 * 공유받은 프레젠테이션의 저장본을 지운다. 그 자리에 소유자 자신의 저장본이 있으면 지우지
 * 않는다(`saveSharedPresentation`과 같은 이유).
 */
export async function deleteSharedPresentation(id: string): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("presentations", "readwrite");
  const remove = (async (): Promise<void> => {
    const stored = await tx.store.get(id);
    if (stored?.access) await tx.store.delete(id);
  })();
  await Promise.all([remove, tx.done]);
}
