import { DeckSchema, type Deck } from "@repo/shared";
import { getOfflineDB } from "./db";
import type { LoadResult, CorruptedRecord } from "./presentationRepository";

/** 0f68563 이전에 쓰던 localStorage 키 */
export const LEGACY_SONGS_KEY = "worship_user_songs_v1";
/** 마이그레이션 후 원본을 보존해 두는 키 */
export const LEGACY_SONGS_BACKUP_KEY = "worship_user_songs_v1__migrated_backup";

/** 보관함 곡(Deck, scope: 'library') 1건 저장 — 전체 교체(put) */
export async function saveSong(deck: Deck): Promise<void> {
  const db = await getOfflineDB();
  await db.put("decks", deck);
}

/** 보관함 곡 전체 조회. 항목별 검증으로 한 건이 깨져도 나머지는 살린다 */
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

/** 보관함 곡 1건 삭제 */
export async function deleteSong(id: string): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("decks", id);
}

/** 테스트 및 저장소 초기화 전용 */
export async function clearAllSongs(): Promise<void> {
  const db = await getOfflineDB();
  await db.clear("decks");
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
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
  } catch {
    // 백업 저장에 실패하면 원본을 지우지 않는다 (다음 부팅에서 재시도)
  }
}

/**
 * 구 localStorage 보관함을 IndexedDB로 1회 이관한다.
 *
 * 항목별로 검증해 유효한 곡만 옮기고, 원본 JSON은 삭제하지 않고 백업 키로 옮긴다.
 * 이전 구현은 배열 전체를 한 번에 파싱해서 한 항목만 깨져도 보관함 전체를 잃었다.
 */
export async function migrateLegacySongs(): Promise<MigrationResult> {
  const raw = readLegacyRaw();
  if (!raw) return { migrated: 0, skipped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON 자체가 깨졌으면 손댈 수 없다. 백업만 남기고 넘어간다.
    moveLegacyToBackup(raw);
    return { migrated: 0, skipped: 0 };
  }

  if (!Array.isArray(parsed)) {
    moveLegacyToBackup(raw);
    return { migrated: 0, skipped: 0 };
  }

  let migrated = 0;
  let skipped = 0;

  for (const item of parsed) {
    const deck = DeckSchema.safeParse(item);
    if (deck.success) {
      await saveSong(deck.data);
      migrated += 1;
    } else {
      skipped += 1;
    }
  }

  moveLegacyToBackup(raw);
  return { migrated, skipped };
}
