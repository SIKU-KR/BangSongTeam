import React, {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import {
  DEFAULT_DECK_STYLE,
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
} from "#shared";
import type { Presentation } from "#shared";
import { SlideStage } from "../components/stage/SlideStage";
import { useBackgroundAutoCache } from "../features/offline";

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
  nextPosition,
  prevPosition,
  getSlideAt,
  getTotalSlideCount,
  positionOfSlideNumber,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "../features/presentation";

/** 청중용 전체화면 송출 라우트 */
export function FullscreenPresentRoute(): React.JSX.Element {
  const navigate = useNavigate();
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

  const currentBackgroundUrl = getBackgroundMediaUrl(currentSong?.backgroundId);
  const currentPosterUrl = getBackgroundPosterUrl(currentSong?.backgroundId);
  const nextSong = songs[position.songIndex + 1]?.deck;
  const nextBackgroundUrl = getBackgroundMediaUrl(nextSong?.backgroundId);

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
    navigate("/presentations");
  }, [navigate]);

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

  if (!found) return <Navigate to="/presentations" replace />;

  return (
    <div
      data-testid="fullscreen-present-route"
      className="relative w-screen h-screen overflow-hidden bg-black select-none group"
    >
      <SlideStage
        slide={currentSlide}
        style={currentStyle}
        backgroundUrl={currentBackgroundUrl}
        nextBackgroundUrl={nextBackgroundUrl}
        posterUrl={currentPosterUrl}
        isBlackout={isBlackout}
        isLyricsHidden={isLyricsHidden}
      />

      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-zinc-900/80 backdrop-blur-sm border border-zinc-700/60 rounded-lg px-3 py-1.5 shadow-lg">
        <button
          type="button"
          data-testid="exit-present-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleExit();
          }}
          className="text-xs text-zinc-300 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
          title="송출 종료 (Esc)"
        >
          송출 종료
        </button>
      </div>
    </div>
  );
}
