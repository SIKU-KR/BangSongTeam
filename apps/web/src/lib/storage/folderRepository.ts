import { FolderSchema, type Folder } from "@repo/shared";
import { getOfflineDB } from "./db";
import type { CorruptedRecord, LoadResult } from "./presentationRepository";

/**
 * 드라이브 폴더 저장소.
 *
 * 폴더는 작고 드물게 바뀌므로 디바운스 없이 바뀔 때마다 1건씩 put한다.
 * 실패(QuotaExceededError 등)는 호출자에게 전파한다.
 */
export async function saveFolder(folder: Folder): Promise<void> {
  const db = await getOfflineDB();
  await db.put("folders", folder);
}

/** 여러 폴더를 한 트랜잭션으로 저장한다 (서버 병합 결과 반영) */
export async function saveFolders(folders: readonly Folder[]): Promise<void> {
  if (folders.length === 0) return;
  const db = await getOfflineDB();
  const tx = db.transaction("folders", "readwrite");
  await Promise.all([
    ...folders.map((folder) => tx.store.put(folder)),
    tx.done,
  ]);
}

/** 저장된 모든 폴더를 읽는다. 항목별로 검증해 한 건이 깨져도 나머지는 살린다 */
export async function loadAllFolders(): Promise<LoadResult<Folder>> {
  const db = await getOfflineDB();
  const rows = await db.getAll("folders");

  const valid: Folder[] = [];
  const corrupted: CorruptedRecord[] = [];

  for (const row of rows) {
    const parsed = FolderSchema.safeParse(row);
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

/** 폴더 여러 건 삭제 (영구 삭제 후 로컬 정리) */
export async function deleteFolders(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getOfflineDB();
  const tx = db.transaction("folders", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/** 테스트 및 저장소 초기화 전용 */
export async function clearAllFolders(): Promise<void> {
  const db = await getOfflineDB();
  await db.clear("folders");
}
