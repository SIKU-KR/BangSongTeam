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
} from "@repo/shared";
import type { Presentation } from "@repo/shared";
import { SlideStage } from "../components/stage/SlideStage";

/** 문서를 찾지 못한 프레임에서 훅 본문이 참조할 빈 폴백 */
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
  clampPosition,
  getSlideAt,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "../features/presentation";

/**
 * 청중용 전체화면 송출 라우트 (`/present/:id/fullscreen`).
 *
 * 한 화면에서 조작과 송출을 겸한다. 키보드·번호 점프가 이 창에서 직접 동작하고,
 * 전체화면이 풀리면 송출을 끝낸다. 청중 화면에는 조작 UI나 번호 버퍼를 일절
 * 표시하지 않는다.
 * 데이터는 하이드레이션된 메모리 상태(원천은 IndexedDB)에서만 읽으므로
 * 송출 중 네트워크 요청이 0건이다.
 */
export function FullscreenPresentRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { presentationId } = useParams<{ presentationId: string }>();

  const found = usePresentationById(presentationId);
  const presentation = found ?? EMPTY_PRESENTATION;

  // 에디터와 동일하게 활성 문서를 URL과 동기화 (뮤테이터/undo가 activeId를 봄)
  useLayoutEffect(() => {
    if (presentationId) openPresentation(presentationId);
  }, [presentationId]);

  const [position, setPosition] =
    useState<ProjectionPosition>(INITIAL_POSITION);
  const [isBlackout, setIsBlackout] = useState<boolean>(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState<boolean>(false);

  const songs = presentation.items;
  const currentSong = songs[position.songIndex]?.deck;
  const currentSlide = getSlideAt(position, songs);
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

  // 배경 영상 및 다음 곡 사전 로드 URL 계산
  const currentBackgroundUrl = getBackgroundMediaUrl(currentSong?.backgroundId);
  const currentPosterUrl = getBackgroundPosterUrl(currentSong?.backgroundId);
  const nextSong = songs[position.songIndex + 1]?.deck;
  const nextBackgroundUrl = getBackgroundMediaUrl(nextSong?.backgroundId);

  // 다음/이전 슬라이드 (곡 경계 자동 전환) — 계산은 projectionState 순수 함수가 맡는다
  const handleNext = useCallback(() => {
    setPosition((prev) => nextPosition(prev, songs));
  }, [songs]);

  const handlePrev = useCallback(() => {
    setPosition((prev) => prevPosition(prev, songs));
  }, [songs]);

  // 숫자 키패드 점프 (N, N., N.M)
  const handleJump = useCallback(
    (songIndex: number, slideIndex: number) => {
      setPosition(clampPosition({ songIndex, slideIndex }, songs));
    },
    [songs],
  );

  const navBuffer = useNavigationBuffer({
    currentSongIndex: position.songIndex,
    songCount: songs.length,
    getSlideCount: (idx) => {
      const item = songs[idx];
      return item?.deck ? item.deck.slides.length : 0;
    },
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

  // Fullscreen 상태 모니터링
  useEffect(() => {
    // 마운트 시 자동 전체화면 진입 시도
    if (!document.fullscreenElement) {
      enterFullscreen().catch(() => {});
    }

    let hasBeenFullscreen = Boolean(document.fullscreenElement);

    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        hasBeenFullscreen = true;
        return;
      }
      // Esc 등으로 전체화면에서 벗어나면 주소창이 보이는 창 모드로 머무르지 않고
      // 즉시 송출을 종료한다.
      if (hasBeenFullscreen) {
        handleExit();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [handleExit]);

  // 얼리 리턴은 반드시 모든 훅 뒤에
  if (!found) return <Navigate to="/presentations" replace />;

  return (
    <div
      data-testid="fullscreen-present-route"
      className="relative w-screen h-screen overflow-hidden bg-black select-none group"
    >
      {/* 3-Layer Slide Stage: 청중 화면 렌더링 (버퍼 텍스트나 조작 UI 일절 포함 안 됨) */}
      <SlideStage
        slide={currentSlide}
        style={currentStyle}
        backgroundUrl={currentBackgroundUrl}
        nextBackgroundUrl={nextBackgroundUrl}
        posterUrl={currentPosterUrl}
        isBlackout={isBlackout}
        isLyricsHidden={isLyricsHidden}
      />

      {/* 마우스 호버 시에만 나타나는 우측 상단 송출 종료 도구 (청중 방해 방지) */}
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
