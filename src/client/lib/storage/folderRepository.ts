import { FolderSchema, type Folder } from "#shared";
import { getOfflineDB } from "./db";
import {
  toCorruptedRecord,
  toLoadedRecord,
  type CorruptedRecord,
  type LoadedRecord,
  type LoadResult,
} from "./presentationRepository";

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
      corrupted.push(toCorruptedRecord(row));
    }
  }

  return { valid, corrupted };
}

/** 폴더 저장본 한 건을 읽는다. 다른 탭이 쓰거나 지운 폴더를 다시 읽을 때 쓴다 */
export async function loadFolder(id: string): Promise<LoadedRecord<Folder>> {
  const db = await getOfflineDB();
  return toLoadedRecord(await db.get("folders", id), FolderSchema);
}

export async function deleteFolders(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getOfflineDB();
  const tx = db.transaction("folders", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}
