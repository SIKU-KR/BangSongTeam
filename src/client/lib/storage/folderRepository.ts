import { FolderSchema, type Folder } from "#shared";
import { getOfflineDB } from "./db";
import type { CorruptedRecord, LoadResult } from "./presentationRepository";

export async function saveFolder(folder: Folder): Promise<void> {
  const db = await getOfflineDB();
  await db.put("folders", folder);
}

export async function saveFolders(folders: readonly Folder[]): Promise<void> {
  if (folders.length === 0) return;
  const db = await getOfflineDB();
  const tx = db.transaction("folders", "readwrite");
  await Promise.all([
    ...folders.map((folder) => tx.store.put(folder)),
    tx.done,
  ]);
}

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

export async function deleteFolders(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getOfflineDB();
  const tx = db.transaction("folders", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/** 테스트 전용: 모든 폴더 데이터 삭제 */
export async function clearAllFolders(): Promise<void> {
  const db = await getOfflineDB();
  await db.clear("folders");
}
