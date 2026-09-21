export {
  useNavigationBuffer,
  type UseNavigationBufferOptions,
  type UseNavigationBufferReturn,
} from "./useNavigationBuffer";

export {
  usePresentationShortcuts,
  type UsePresentationShortcutsOptions,
} from "./usePresentationShortcuts";

export { mockSetlist, mockDecks } from "./mockSetlist";

export {
  getActiveSetlist,
  setActiveSetlist,
  createNewSetlist,
  addDeckToSetlist,
  resetActiveSetlist,
  useActiveSetlist,
  updateSetlistTitle,
  updateSongInfo,
  updateSongStyle,
  updateSongBackground,
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  reorderSongs,
  removeSongFromSetlist,
  duplicateSongInSetlist,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
} from "./setlistStore";

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
