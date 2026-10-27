export {
  savePresentation,
  loadAllPresentations,
  loadPresentation,
  deletePresentation,
  saveSharedPresentation,
  deleteSharedPresentation,
  type LoadedRecord,
} from "./presentationRepository";
export {
  saveFolder,
  saveFolders,
  loadAllFolders,
  loadFolder,
  deleteFolders,
} from "./folderRepository";
export {
  saveSong,
  loadAllSongs,
  loadSong,
  deleteSong,
  clearAllSongs,
  migrateLegacySongs,
} from "./songRepository";
export {
  loadAllBackgrounds,
  replaceAllBackgrounds,
} from "./backgroundRepository";
export {
  reportPersistenceError,
  clearPersistenceError,
  usePersistenceError,
  reportCorruptedRecords,
  useCorruptedRecords,
} from "./persistenceStatus";
