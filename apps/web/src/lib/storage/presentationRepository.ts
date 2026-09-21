import { PresentationSchema, type Presentation } from "@repo/shared";
import { getOfflineDB } from "./db";

/**
 * 스키마 검증에 실패한 저장본. 삭제하지 않고 그대로 두어 복구 가능성을 남긴다
 * (TECH_SPEC §5.5 Phase 2 규칙 5).
 */
export interface CorruptedRecord {
  id: string;
  reason: string;
}

export interface LoadResult<T> {
  valid: T[];
  corrupted: CorruptedRecord[];
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

/**
 * 저장된 모든 프레젠테이션을 읽는다.
 * 항목별로 검증해 한 건이 깨져도 나머지는 살린다.
 */
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
      corrupted.push({
        id:
          typeof (row as { id?: unknown })?.id === "string"
            ? (row as { id: string }).id
            : "(unknown)",
        reason: parsed.error.issues[0]?.message ?? "schema validation failed",
      });
    }
  }

  return { valid, corrupted };
}

/** 프레젠테이션 문서 1건 삭제 (임베드된 덱도 문서와 함께 사라진다) */
export async function deletePresentation(id: string): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("presentations", id);
}

/** 테스트 및 저장소 초기화 전용 */
export async function clearAllPresentations(): Promise<void> {
  const db = await getOfflineDB();
  await db.clear("presentations");
}
