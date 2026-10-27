import type { z } from "zod";
import { PresentationSchema, type Presentation } from "#shared";
import { getOfflineDB } from "./db";

/** 스키마 검증에 실패한 저장본. 삭제하지 않고 그대로 두어 복구 가능성을 남긴다 */
export interface CorruptedRecord {
  id: string;
}

export interface LoadResult<T> {
  valid: T[];
  corrupted: CorruptedRecord[];
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

/**
 * 프레젠테이션 문서 1건을 전체 교체(put)한다.
 * 부분 갱신을 쓰지 않는 이유: 마지막 쓰기가 유실돼도 직전 저장본이 온전히 남아야 한다.
 *
 * 저장 실패(QuotaExceededError 등)는 삼키지 않고 호출자에게 전파한다.
 */
export async function savePresentation(
  presentation: Presentation,
): Promise<void> {
  const db = await getOfflineDB();
  await db.put("presentations", presentation);
}

/** 항목별로 검증해 한 건이 깨져도 나머지는 살린다 */
export async function loadAllPresentations(): Promise<
  LoadResult<Presentation>
> {
  const db = await getOfflineDB();
  const rows = await db.getAll("presentations");

  const valid: Presentation[] = [];
  const corrupted: CorruptedRecord[] = [];

  for (const row of rows) {
    const parsed = PresentationSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      corrupted.push(toCorruptedRecord(row));
    }
  }

  return { valid, corrupted };
}

/**
 * 프레젠테이션 저장본 한 건을 읽는다. 다른 탭이 쓰거나 지운 저장본을 다시 읽을 때 쓴다.
 *
 * 스키마에 없는 필드는 떼고 읽는다. 새 버전의 탭이 남긴 필드(기준 판 `baseUpdatedAt` 등)를 이
 * 버전이 들고 있다가 다시 쓰거나 올리면, 그 값이 앞으로 나아가지 않은 채 남는다.
 */
export async function loadPresentation(
  id: string,
): Promise<LoadedRecord<Presentation>> {
  const db = await getOfflineDB();
  return toLoadedRecord(await db.get("presentations", id), PresentationSchema);
}

/** 임베드된 덱도 문서와 함께 사라진다 */
export async function deletePresentation(id: string): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("presentations", id);
}

/**
 * 링크로 공유받은 프레젠테이션(`access`가 있는 사본)을 저장한다. 같은 id 자리에 소유자 자신의
 * 저장본이 있으면 쓰지 않는다.
 *
 * 저장소는 id 하나로만 저장본을 가르므로, 한 브라우저를 소유자와 공유받은 사람이 함께 쓰면 두
 * 사람의 사본이 한 자리를 나눠 쓴다. 공유받은 사본이 덮으면 소유자가 아직 올리지 못한 편집이
 * 사라지고, 소유자는 자기 프레젠테이션을 보기 전용으로 읽게 된다. 읽기와 쓰기를 한 readwrite
 * 트랜잭션에서 해, 그사이 소유자의 탭이 쓴 저장본도 덮지 않는다. 저장소 버전을 올리지 않아
 * 같은 저장소를 여는 이전 버전의 탭도 그대로 열린다.
 */
export async function saveSharedPresentation(
  presentation: Presentation,
): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("presentations", "readwrite");
  const write = (async (): Promise<void> => {
    const stored = await tx.store.get(presentation.id);
    if (!stored || stored.access) await tx.store.put(presentation);
  })();
  await Promise.all([write, tx.done]);
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
