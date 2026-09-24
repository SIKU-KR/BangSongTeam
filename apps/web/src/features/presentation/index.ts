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
  linkSongToLibraryDeck,
  loadSampleSongsIntoActivePresentation,
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
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  reorderSongs,
  removeSongFromPresentation,
  duplicateSongInPresentation,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
  hydrateFromStorage,
  flushPendingWrites,
  removePersistedPresentation,
  resetPersistenceForTests,
} from "./presentationStore";

export {
  PresentationCard,
  type PresentationCardProps,
} from "./PresentationCard";

export {
  enterFullscreen,
  exitFullscreen,
  launchPresentation,
  type ChromeFullscreenOptions,
} from "./fullscreen";

export {
  nextPosition,
  prevPosition,
  clampPosition,
  getSlideAt,
  getTotalSlideCount,
  positionOfSlideNumber,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "./projectionState";
