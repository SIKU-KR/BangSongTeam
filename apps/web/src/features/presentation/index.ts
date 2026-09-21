export {
  useNavigationBuffer,
  type UseNavigationBufferOptions,
  type UseNavigationBufferReturn,
} from "./useNavigationBuffer";

export {
  usePresentationShortcuts,
  type UsePresentationShortcutsOptions,
} from "./usePresentationShortcuts";

export { mockPresentation, mockDecks } from "./mockPresentation";

export {
  getActivePresentation,
  setActivePresentation,
  createNewPresentation,
  addDeckToPresentation,
  resetActivePresentation,
  useActivePresentation,
  updatePresentationTitle,
  updateSongInfo,
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
