export {
  useNavigationBuffer,
  type UseNavigationBufferOptions,
  type UseNavigationBufferReturn,
} from "./useNavigationBuffer";

export {
  usePresentationShortcuts,
  type UsePresentationShortcutsOptions,
} from "./usePresentationShortcuts";

export {
  mockPresentation,
  mockDecks,
  MOCK_PRESENTATION_ID,
  MOCK_USER_ID,
} from "./mockPresentation";

export {
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
  SEED_USER_ID,
} from "./mockPresentations";

export {
  getActivePresentation,
  createNewPresentation,
  addDeckToPresentation,
  resetPresentationStore,
  __loadDocumentsForTests,
  applyServerDocuments,
  useActivePresentation,
  getPresentationById,
  listPresentations,
  getActivePresentationId,
  openPresentation,
  usePresentationList,
  usePresentationById,
  updatePresentationTitle,
  updateSongStyle,
  updateSongBackground,
  updateSongInfo,
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  splitSlideAtCursor,
  mergeSlideWithNext,
  reorderSongs,
  removeSongFromPresentation,
  duplicateSongInPresentation,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
  breakHistoryCoalescing,
  type HistoryOptions,
  hydrateFromStorage,
  flushPendingWrites,
  removePersistedPresentation,
  resetPersistenceForTests,
  movePresentation,
  renamePresentation,
  trashPresentation,
  restorePresentation,
  duplicatePresentation,
  removePresentationsLocally,
} from "./presentationStore";

export {
  enterFullscreen,
  exitFullscreen,
  launchPresentation,
  resolvePresentReturnPath,
  DEFAULT_PRESENT_RETURN_PATH,
  type ChromeFullscreenOptions,
  type PresentNavigate,
} from "./fullscreen";

export {
  nextPosition,
  prevPosition,
  clampPosition,
  getSlideAt,
  getTotalSlideCount,
  positionOfSlideNumber,
  slideNumberOfPosition,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "./projectionState";
