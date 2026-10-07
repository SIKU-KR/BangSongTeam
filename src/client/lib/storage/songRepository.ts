import { DeckSchema, type Deck } from "#shared";
import { getOfflineDB } from "./db";
import {
  toCorruptedRecord,
  type CorruptedRecord,
  type LoadResult,
} from "./presentationRepository";

/** 0f68563 이전에 쓰던 localStorage 키 */
export const LEGACY_SONGS_KEY = "worship_user_songs_v1";
export const LEGACY_SONGS_BACKUP_KEY = "worship_user_songs_v1__migrated_backup";

export async function saveSong(deck: Deck): Promise<void> {
  const db = await getOfflineDB();
  await db.put("decks", deck);
}

/** 항목별 검증으로 한 건이 깨져도 나머지는 살린다 */
export async function loadAllSongs(): Promise<LoadResult<Deck>> {
  const db = await getOfflineDB();
  const rows = await db.getAll("decks");

  const valid: Deck[] = [];
  const corrupted: CorruptedRecord[] = [];

  for (const row of rows) {
    const parsed = DeckSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      corrupted.push(toCorruptedRecord(row));
    }
  }

  return { valid, corrupted };
}

export async function deleteSong(id: string): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("decks", id);
}

/** 테스트 및 저장소 초기화 전용 */
export async function clearAllSongs(): Promise<void> {
  const db = await getOfflineDB();
  await db.clear("decks");
}

function readLegacyRaw(): string | null {
  try {
    return localStorage.getItem(LEGACY_SONGS_KEY);
  } catch {
    return null;
  }
}

function moveLegacyToBackup(raw: string): void {
  try {
    localStorage.setItem(LEGACY_SONGS_BACKUP_KEY, raw);
    localStorage.removeItem(LEGACY_SONGS_KEY);
  } catch (error) {
    void error;
  }
}

/**
 * 구 localStorage 보관함을 IndexedDB로 1회 이관한다.
 *
 * 항목별로 검증해 유효한 곡만 옮기고, 원본 JSON은 삭제하지 않고 백업 키로 옮긴다.
 * 이전 구현은 배열 전체를 한 번에 파싱해서 한 항목만 깨져도 보관함 전체를 잃었다.
 */
export async function migrateLegacySongs(): Promise<void> {
  const raw = readLegacyRaw();
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    moveLegacyToBackup(raw);
    return;
  }

  if (!Array.isArray(parsed)) {
    moveLegacyToBackup(raw);
    return;
  }

  for (const item of parsed) {
    const deck = DeckSchema.safeParse(item);
    if (deck.success) {
      await saveSong(deck.data);
    }
  }

  moveLegacyToBackup(raw);
}
