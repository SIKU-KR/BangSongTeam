import React, { useState, useCallback, useEffect } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  Navigate,
} from "react-router-dom";
import { Button } from "#components/ui/button";
import { Kbd } from "#components/ui/kbd";
import { DEFAULT_DECK_STYLE } from "#shared";
import { SlideStage } from "../components/stage/SlideStage";
import { ProjectionMediaGate } from "../features/offline/ProjectionMediaGate";
import { usePresentationFontsReady } from "../features/offline/usePresentationFontsReady";
import { useProjectionMediaCache } from "../features/offline/useBackgroundAutoCache";
import { useProjectionMediaReady } from "../features/offline/useProjectionMediaReady";
import { useBackgroundLayers } from "../features/backgrounds/backgroundCatalog";
import {
  useNavigationBuffer,
  usePresentationShortcuts,
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
import { useOpenedPresentation } from "../features/presentation/useOpenedPresentation";
import { useFullscreenSession } from "../features/presentation/useFullscreenSession";
import { PRESENTATION_COPY } from "#copy/presentation";

const noop = (): void => {};

/**
 * 청중용 전체화면 송출 라우트. 종료하면 송출을 시작한 화면으로 돌아간다.
 *
 * 세트의 배경 영상을 모두 이 기기에 저장하거나 운영자가 저장된 배경으로 시작하기 전에는
 * 슬라이드 대신 준비 카드를 띄우고 슬라이드 이동을 막는다(`useProjectionMediaReady`).
 * 한 번 시작한 뒤에는 세트가 바뀌어도 다시 가리지 않는다 — 예배 중에 화면이 준비 카드로
 * 바뀌면 안 되므로, 남은 배경과 새로 생긴 배경은 지금·다음 곡을 먼저 받는 백그라운드
 * 큐(`useProjectionMediaCache`)에 맡긴다. 준비 카드가 세트 순서대로 계속 받으면 송출 중인
 * 배경 영상과 대역폭을 다툰다.
 */
export function FullscreenPresentRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = resolvePresentReturnPath(location.state);
  const { presentationId } = useParams<{ presentationId: string }>();

  const { found, presentation } = useOpenedPresentation(presentationId);

  const [position, setPosition] =
    useState<ProjectionPosition>(INITIAL_POSITION);
  const fontsReady = usePresentationFontsReady(found ?? null);
  useProjectionMediaCache(found ?? null, position.songIndex);
  const [hasStarted, setHasStarted] = useState(false);
  const mediaReadiness = useProjectionMediaReady(
    hasStarted ? null : (found ?? null),
  );
  const isPreparing = !hasStarted && mediaReadiness.status !== "ready";

  useEffect(() => {
    if (mediaReadiness.status === "ready") setHasStarted(true);
  }, [mediaReadiness.status]);
  const [isBlackout, setIsBlackout] = useState<boolean>(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState<boolean>(false);

  const songs = presentation.items;
  const currentSong = songs[position.songIndex]?.deck;
  const currentSlide = getSlideAt(position, songs);
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

  const currentBackground = useBackgroundLayers(currentSong?.backgroundId);
  const nextSong = songs[position.songIndex + 1]?.deck;
  const nextBackground = useBackgroundLayers(nextSong?.backgroundId);

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
    onNext: isPreparing ? noop : handleNext,
    onPrev: isPreparing ? noop : handlePrev,
    onToggleBlackout: () => setIsBlackout((prev) => !prev),
    onToggleLyrics: () => setIsLyricsHidden((prev) => !prev),
    onExit: handleExit,
    navigationBuffer: navBuffer,
  });

  useFullscreenSession(handleExit);

  if (!found) return <Navigate to={DEFAULT_PRESENT_RETURN_PATH} replace />;

  return (
    <div
      data-testid="fullscreen-present-route"
      className="group relative h-screen w-screen overflow-hidden bg-black select-none"
    >
      {isPreparing ? (
        <ProjectionMediaGate
          readiness={mediaReadiness}
          onStartWithSaved={() => setHasStarted(true)}
        />
      ) : (
        <SlideStage
          slide={currentSlide}
          style={currentStyle}
          backgroundUrl={currentBackground.videoUrl}
          backgroundImageUrl={currentBackground.imageUrl}
          nextBackgroundUrl={nextBackground.videoUrl}
          posterUrl={currentBackground.posterUrl}
          isBlackout={isBlackout}
          isLyricsHidden={isLyricsHidden || !fontsReady}
        />
      )}

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
          {PRESENTATION_COPY.exit}
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}
