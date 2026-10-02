import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  Navigate,
} from "react-router-dom";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { Kbd } from "#components/ui/kbd";
import { DEFAULT_DECK_STYLE, type Presentation } from "#shared";
import { ProjectionErrorBoundary } from "../components/stage/ProjectionErrorBoundary";
import { SlideStage } from "../components/stage/SlideStage";
import { ProjectionMediaGate } from "../features/offline/ProjectionMediaGate";
import { usePresentationFontsReady } from "../features/offline/usePresentationFontsReady";
import { useProjectionMediaCache } from "../features/offline/useBackgroundAutoCache";
import { useProjectionMediaReady } from "../features/offline/useProjectionMediaReady";
import { useBackgroundLayers } from "../features/backgrounds/backgroundCatalog";
import {
  exitFullscreen,
  resolvePresentReturnPath,
  DEFAULT_PRESENT_RETURN_PATH,
} from "../features/presentation/fullscreen";
import {
  anchorPosition,
  nextPosition,
  prevPosition,
  getSlideAt,
  getTotalSlideCount,
  positionOfSlideNumber,
  resolveAnchoredPosition,
  INITIAL_POSITION,
  type AnchoredPosition,
} from "../features/presentation/projectionState";
import {
  clearProjectionResume,
  loadProjectionResume,
  saveProjectionResume,
} from "../features/presentation/projectionResume";
import { useNavigationBuffer } from "../features/presentation/useNavigationBuffer";
import { usePresentationShortcuts } from "../features/presentation/usePresentationShortcuts";
import { useOpenedPresentation } from "../features/presentation/useOpenedPresentation";
import { useFullscreenSession } from "../features/presentation/useFullscreenSession";
import { useProjectionHistoryGuard } from "../features/presentation/useProjectionHistoryGuard";
import { useIdlePointer } from "../features/presentation/useIdlePointer";
import { useScreenWakeLock } from "../features/presentation/useScreenWakeLock";
import { PRESENTATION_COPY } from "#copy/presentation";

const noop = (): void => {};

const EXIT_FULLSCREEN_TIMEOUT_MS = 1000;

const preventDefault = (event: React.SyntheticEvent): void => {
  event.preventDefault();
};

/**
 * 청중용 전체화면 송출 라우트. 종료하면 송출을 시작한 화면으로 돌아간다.
 *
 * 세트의 배경 영상을 모두 이 기기에 저장하기 전에는 슬라이드 대신 준비 카드를 띄우고
 * 슬라이드 이동을 막는다(`useProjectionMediaReady`). 한 번 시작한 뒤에는 세트가 바뀌어도
 * 다시 가리지 않는다 — 예배 중에 화면이 준비 카드로 바뀌면 안 되므로, 새로 생긴 배경은
 * 백그라운드 큐(`useProjectionMediaCache`)에 맡긴다.
 *
 * 송출은 운영자가 Esc나 종료 버튼으로 끝낼 때만 끝난다. 전체화면이 풀리거나, 뒤로 가기·
 * 새로고침을 누르거나, 다른 곳에서 프레젠테이션이 바뀌어도 청중 화면은 이어진다.
 * 위치는 처음부터 곡 id에 고정해, 첫 슬라이드를 띄워 둔 채 곡 순서가 바뀌어도 화면이 그대로다.
 * 새로고침되면 같은 탭에 저장한 위치·블랙아웃·가사 숨김으로 다시 뜬다.
 *
 * 송출할 프레젠테이션을 찾지 못하면 송출 화면을 마운트하지 않고 드라이브로 보낸다.
 * 이때 전체화면을 풀어, 다음 화면이 전체화면에 갇히지 않게 한다. 송출 화면의 전체화면·
 * history·화면 잠금 방지는 송출할 내용이 있을 때만 건다.
 *
 * 프레젠테이션이 한 번 보인 뒤 다른 곳에서 사라지면 마지막으로 받은 내용으로 송출을 이어 간다.
 */
export function FullscreenPresentRoute(): React.JSX.Element {
  const { presentationId } = useParams<{ presentationId: string }>();
  const { found } = useOpenedPresentation(presentationId);
  const [lastShown, setLastShown] = useState(found);
  if (found && found !== lastShown) setLastShown(found);
  const shown =
    found ?? (lastShown?.id === presentationId ? lastShown : undefined);

  if (!presentationId || !shown) return <ProjectionRedirect />;

  return (
    <ProjectionSession
      key={presentationId}
      presentationId={presentationId}
      presentation={shown}
    />
  );
}

function ProjectionRedirect(): React.JSX.Element {
  useEffect(() => {
    exitFullscreen().catch(() => {});
  }, []);
  return <Navigate to={DEFAULT_PRESENT_RETURN_PATH} replace />;
}

function exitFullscreenWithin(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void exitFullscreen()
      .catch(() => false)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

interface ProjectionSessionProps {
  presentationId: string;
  presentation: Presentation;
}

function ProjectionSession({
  presentationId,
  presentation: shown,
}: ProjectionSessionProps): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = resolvePresentReturnPath(location.state);
  const songs = shown.items;

  const [resume] = useState(() => loadProjectionResume(presentationId));
  const [anchored, setAnchored] = useState<AnchoredPosition>(() =>
    resume
      ? {
          songIndex: resume.songIndex,
          slideIndex: resume.slideIndex,
          itemId: resume.itemId,
        }
      : { ...INITIAL_POSITION, itemId: null },
  );
  const position = resolveAnchoredPosition(anchored, songs);
  if (anchored.itemId === null && songs.length > 0) {
    setAnchored(anchorPosition(position, songs));
  }
  const fontsReady = usePresentationFontsReady(shown);
  useProjectionMediaCache(shown, position.songIndex);
  const mediaReadiness = useProjectionMediaReady(shown);
  const [hasStarted, setHasStarted] = useState(resume?.hasStarted ?? false);
  const isPreparing = !hasStarted && mediaReadiness.status !== "ready";

  useEffect(() => {
    if (mediaReadiness.status === "ready") setHasStarted(true);
  }, [mediaReadiness.status]);
  const [isBlackout, setIsBlackout] = useState(resume?.isBlackout ?? false);
  const [isLyricsHidden, setIsLyricsHidden] = useState(
    resume?.isLyricsHidden ?? false,
  );

  const currentSong = songs[position.songIndex]?.deck;
  const currentSlide = getSlideAt(position, songs);
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

  const currentBackground = useBackgroundLayers(currentSong?.backgroundId);
  const nextSong = songs[position.songIndex + 1]?.deck;
  const nextBackground = useBackgroundLayers(nextSong?.backgroundId);

  const handleJump = useCallback(
    (slideNumber: number) => {
      const target = positionOfSlideNumber(slideNumber, songs);
      if (target) setAnchored(anchorPosition(target, songs));
    },
    [songs],
  );

  const navBuffer = useNavigationBuffer({
    totalSlides: getTotalSlideCount(songs),
    onJump: handleJump,
  });
  const clearNavBuffer = navBuffer.clear;

  const handleNext = useCallback(() => {
    clearNavBuffer();
    setAnchored((prev) =>
      anchorPosition(
        nextPosition(resolveAnchoredPosition(prev, songs), songs),
        songs,
      ),
    );
  }, [clearNavBuffer, songs]);

  const handlePrev = useCallback(() => {
    clearNavBuffer();
    setAnchored((prev) =>
      anchorPosition(
        prevPosition(resolveAnchoredPosition(prev, songs), songs),
        songs,
      ),
    );
  }, [clearNavBuffer, songs]);

  const isExitingRef = useRef(false);
  const releaseHistory = useProjectionHistoryGuard();

  useEffect(() => {
    if (isExitingRef.current) return;
    saveProjectionResume(presentationId, {
      ...anchored,
      hasStarted,
      isBlackout,
      isLyricsHidden,
    });
  }, [presentationId, anchored, hasStarted, isBlackout, isLyricsHidden]);

  const handleExit = useCallback(async () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    clearProjectionResume(presentationId);
    await exitFullscreenWithin(EXIT_FULLSCREEN_TIMEOUT_MS);
    await releaseHistory();
    navigate(returnPath, { replace: true });
  }, [navigate, presentationId, releaseHistory, returnPath]);

  usePresentationShortcuts({
    onNext: isPreparing ? noop : handleNext,
    onPrev: isPreparing ? noop : handlePrev,
    onToggleBlackout: () => setIsBlackout((prev) => !prev),
    onToggleLyrics: () => setIsLyricsHidden((prev) => !prev),
    onExit: handleExit,
    navigationBuffer: navBuffer,
  });

  useFullscreenSession(isExitingRef);
  useScreenWakeLock();
  const isPointerActive = useIdlePointer();

  return (
    <div
      data-testid="fullscreen-present-route"
      onContextMenu={preventDefault}
      className={cn(
        "relative h-screen w-screen overflow-hidden bg-black select-none",
        !isPreparing && !isPointerActive && "cursor-none",
      )}
    >
      {isPreparing ? (
        <ProjectionMediaGate
          readiness={mediaReadiness}
          onStartWithSaved={() => setHasStarted(true)}
        />
      ) : (
        <ProjectionErrorBoundary
          resetKey={`${position.songIndex}:${position.slideIndex}`}
        >
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
        </ProjectionErrorBoundary>
      )}

      <div
        data-testid="exit-present-chip"
        className={cn(
          "absolute top-4 right-4 z-50 rounded-lg border border-white/15 bg-black/70 p-1 shadow-lg backdrop-blur-sm transition-opacity duration-300 has-focus-visible:pointer-events-auto has-focus-visible:opacity-100",
          isPreparing || isPointerActive
            ? "opacity-100"
            : "pointer-events-none opacity-0",
        )}
      >
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
