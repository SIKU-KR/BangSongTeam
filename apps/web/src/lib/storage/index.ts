export {
  getOfflineDB,
  closeOfflineDB,
  isPersistenceAvailable,
  PersistenceUnavailableError,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  type WorshipOfflineDB,
} from "./db";

export {
  savePresentation,
  loadAllPresentations,
  deletePresentation,
  clearAllPresentations,
  type LoadResult,
  type CorruptedRecord,
} from "./presentationRepository";

export {
  saveSong,
  loadAllSongs,
  deleteSong,
  clearAllSongs,
  migrateLegacySongs,
  LEGACY_SONGS_KEY,
  LEGACY_SONGS_BACKUP_KEY,
  type MigrationResult,
} from "./songRepository";

export {
  reportPersistenceError,
  clearPersistenceError,
  getPersistenceError,
  usePersistenceError,
  reportCorruptedRecords,
  clearCorruptedRecords,
  getCorruptedRecords,
  useCorruptedRecords,
  type PersistenceError,
  type PersistenceErrorKind,
} from "./persistenceStatus";

export {
  saveOfflineStatus,
  loadOfflineStatus,
  clearOfflineStatus,
  type OfflineStatus,
  type OfflineStatusPatch,
} from "./offlineStatusRepository";
