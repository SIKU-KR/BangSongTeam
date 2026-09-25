import React, {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  Navigate,
} from "react-router-dom";
import { Button } from "#components/ui/button";
import { DEFAULT_DECK_STYLE } from "#shared";
import type { Presentation } from "#shared";
import { SlideStage } from "../components/stage/SlideStage";
import { useBackgroundAutoCache } from "../features/offline";
import {
  resolveBackgroundLayers,
  useBackground,
} from "../features/backgrounds/backgroundCatalog";

const EMPTY_PRESENTATION: Presentation = {
  id: "",
  userId: "",
  title: "",
  serviceDate: "",
  items: [],
  createdAt: "",
  updatedAt: "",
};
import {
  usePresentationById,
  openPresentation,
  useNavigationBuffer,
  usePresentationShortcuts,
  enterFullscreen,
  exitFullscreen,
  resolvePresentReturnPath,
  DEFAULT_PRESENT_RETURN_PATH,
  nextPosition,
  prevPosition,
  getSlideAt,
  getTotalSlideCount,
  positionOfSlideNumber,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "../features/presentation";

/** 청중용 전체화면 송출 라우트. 종료하면 송출을 시작한 화면으로 돌아간다. */
export function FullscreenPresentRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = resolvePresentReturnPath(location.state);
  const { presentationId } = useParams<{ presentationId: string }>();

  const found = usePresentationById(presentationId);
  const presentation = found ?? EMPTY_PRESENTATION;

  useLayoutEffect(() => {
    if (presentationId) openPresentation(presentationId);
  }, [presentationId]);

  useBackgroundAutoCache(found ?? null);

  const [position, setPosition] =
    useState<ProjectionPosition>(INITIAL_POSITION);
  const [isBlackout, setIsBlackout] = useState<boolean>(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState<boolean>(false);

  const songs = presentation.items;
  const currentSong = songs[position.songIndex]?.deck;
  const currentSlide = getSlideAt(position, songs);
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

  const currentBackground = resolveBackgroundLayers(
    useBackground(currentSong?.backgroundId),
  );
  const nextSong = songs[position.songIndex + 1]?.deck;
  const nextBackground = resolveBackgroundLayers(
    useBackground(nextSong?.backgroundId),
  );

  const handleNext = useCallback(() => {
    setPosition((prev) => nextPosition(prev, songs));
  }, [songs]);

  const handlePrev = useCallback(() => {
    setPosition((prev) => prevPosition(prev, songs));
  }, [songs]);

  const handleJump = useCallback(
    (slideNumber: number) => {
      const target = positionOfSlideNumber(slideNumber, songs);
      if (target) setPosition(target);
    },
    [songs],
  );

  const navBuffer = useNavigationBuffer({
    totalSlides: getTotalSlideCount(songs),
    onJump: handleJump,
  });

  const handleExit = useCallback(async () => {
    await exitFullscreen().catch(() => {});
    navigate(returnPath);
  }, [navigate, returnPath]);

  usePresentationShortcuts({
    onNext: handleNext,
    onPrev: handlePrev,
    onToggleBlackout: () => setIsBlackout((prev) => !prev),
    onToggleLyrics: () => setIsLyricsHidden((prev) => !prev),
    onExit: handleExit,
    navigationBuffer: navBuffer,
  });

  useEffect(() => {
    if (!document.fullscreenElement) {
      enterFullscreen().catch(() => {});
    }

    let hasBeenFullscreen = Boolean(document.fullscreenElement);

    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        hasBeenFullscreen = true;
        return;
      }
      if (hasBeenFullscreen) {
        handleExit();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [handleExit]);

  if (!found) return <Navigate to={DEFAULT_PRESENT_RETURN_PATH} replace />;

  return (
    <div
      data-testid="fullscreen-present-route"
      className="group relative h-screen w-screen overflow-hidden bg-black select-none"
    >
      <SlideStage
        slide={currentSlide}
        style={currentStyle}
        backgroundUrl={currentBackground.videoUrl}
        backgroundImageUrl={currentBackground.imageUrl}
        nextBackgroundUrl={nextBackground.videoUrl}
        posterUrl={currentBackground.posterUrl}
        isBlackout={isBlackout}
        isLyricsHidden={isLyricsHidden}
      />

      <div className="absolute top-4 right-4 z-50 rounded-lg border border-white/15 bg-black/70 p-1 opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          data-testid="exit-present-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleExit();
          }}
          className="text-white/80 hover:bg-white/10 hover:text-white"
        >
          송출 종료
          <kbd className="font-sans text-white/50">Esc</kbd>
        </Button>
      </div>
    </div>
  );
}
