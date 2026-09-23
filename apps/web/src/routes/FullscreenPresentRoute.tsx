import React, {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import {
  AUDIENCE_MODE_PARAM,
  DEFAULT_DECK_STYLE,
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
} from "@repo/shared";
import type { BroadcastMessage, Presentation } from "@repo/shared";
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
  useProjectionChannel,
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
 * 청중용 전체화면 송출 라우트.
 *
 * 두 가지 모드로 쓰인다.
 *
 * 1. **단독 모드** (`/present/:id/fullscreen`) — 한 화면에서 조작과 송출을 겸한다.
 *    키보드·번호 점프가 이 창에서 직접 동작하고, 전체화면이 풀리면 송출을 끝낸다.
 * 2. **청중 모드** (`?audience=1`) — 발표자 보기가 `window.open`으로 연 송출 창이다.
 *    조작은 조작 창에서만 하고 이 창은 BroadcastChannel 지시만 따른다.
 *
 * 두 모드 모두 청중 화면에 조작 UI나 번호 버퍼를 일절 표시하지 않는다.
 * 데이터는 하이드레이션된 메모리 상태(원천은 IndexedDB)에서만 읽으므로
 * 송출 중 네트워크 요청이 0건이다.
 */
export function FullscreenPresentRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { presentationId } = useParams<{ presentationId: string }>();
  const [searchParams] = useSearchParams();
  const isAudienceMode = searchParams.get(AUDIENCE_MODE_PARAM) === "1";

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
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== "undefined" && Boolean(document.fullscreenElement),
  );

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
    // 청중 창은 조작 창이 연 팝업이다. 대시보드로 되돌리는 대신 창을 닫는다.
    if (isAudienceMode) {
      window.close();
      return;
    }
    navigate("/presentations");
  }, [isAudienceMode, navigate]);

  // 조작 창의 지시를 따른다 (청중 모드 전용).
  const handleMessage = useCallback(
    (message: BroadcastMessage) => {
      if (!isAudienceMode) return;

      switch (message.type) {
        case "SYNC_SNAPSHOT":
          // 들어온 인덱스를 그대로 믿지 않는다. 두 창이 다른 세트를 들고 있으면
          // 범위를 벗어난 값이 올 수 있고, 그러면 청중 화면이 비어 버린다.
          setPosition(
            clampPosition(
              {
                songIndex: message.payload.currentSongIndex,
                slideIndex: message.payload.currentSlideIndex,
              },
              songs,
            ),
          );
          setIsBlackout(message.payload.isBlackout);
          setIsLyricsHidden(message.payload.isLyricsHidden);
          break;
        case "NAVIGATE_SLIDE":
          setPosition(
            clampPosition(
              {
                songIndex: message.payload.songIndex,
                slideIndex: message.payload.slideIndex,
              },
              songs,
            ),
          );
          break;
        case "SET_BLACKOUT":
          setIsBlackout(message.payload.isBlackout);
          break;
        case "SET_LYRICS_HIDDEN":
          setIsLyricsHidden(message.payload.isLyricsHidden);
          break;
        default:
          break;
      }
    },
    [isAudienceMode, songs],
  );

  const { post } = useProjectionChannel({
    onMessage: handleMessage,
    enabled: isAudienceMode,
  });

  // 청중 창이 준비되었음을 알린다. 조작 창이 즉시 SYNC_SNAPSHOT으로 회신한다
  // (TECH_SPEC 5.3 핸드셰이크).
  useEffect(() => {
    if (!isAudienceMode) return;
    post({ type: "AUDIENCE_MOUNTED", timestamp: Date.now() });
  }, [isAudienceMode, post]);

  usePresentationShortcuts({
    onNext: handleNext,
    onPrev: handlePrev,
    onToggleBlackout: () => setIsBlackout((prev) => !prev),
    onToggleLyrics: () => setIsLyricsHidden((prev) => !prev),
    onExit: handleExit,
    navigationBuffer: navBuffer,
    // 청중 창에서는 키보드를 받지 않는다. 상태의 단일 원천은 조작 창이며,
    // 이 창에서 B나 방향키가 눌리면 두 화면이 어긋난다.
    enabled: !isAudienceMode,
  });

  // Fullscreen 상태 모니터링
  useEffect(() => {
    // 마운트 시 자동 전체화면 진입 시도
    if (!document.fullscreenElement) {
      enterFullscreen().catch(() => {});
    }

    let hasBeenFullscreen = Boolean(document.fullscreenElement);

    const handleFullscreenChange = () => {
      const inFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(inFullscreen);
      if (inFullscreen) {
        hasBeenFullscreen = true;
        return;
      }
      // 청중 창은 전체화면을 벗어나도 살아 있어야 한다. 조작자가 창을 프로젝터로
      // 옮기는 동안 전체화면이 풀리는데, 여기서 라우트를 떠나면 송출이 끊긴다.
      if (hasBeenFullscreen && !isAudienceMode) {
        // Esc 등으로 전체화면에서 벗어난 단독 모드는 주소창이 보이는 창 모드로
        // 머무르지 않고 즉시 송출을 종료한다.
        handleExit();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [handleExit, isAudienceMode]);

  // 얼리 리턴은 반드시 모든 훅 뒤에
  if (!found) return <Navigate to="/presentations" replace />;

  return (
    <div
      data-testid="fullscreen-present-route"
      data-audience={isAudienceMode ? "1" : undefined}
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

      {/* 청중 창을 프로젝터로 옮기는 동안의 안내 (PRD 7.3).
          전체화면이 아닐 때만 보이며, 클릭하면 전체화면으로 들어간다. */}
      {isAudienceMode && !isFullscreen && (
        <button
          type="button"
          data-testid="audience-fullscreen-hint"
          onClick={() => {
            void enterFullscreen();
          }}
          className="absolute inset-x-0 bottom-0 z-40 px-6 py-4 bg-zinc-900/85 text-zinc-100 text-sm text-center backdrop-blur-sm cursor-pointer hover:bg-zinc-900/95 transition-colors"
        >
          이 창을 프로젝터 화면으로 옮긴 뒤 클릭하면 전체화면이 됩니다.
        </button>
      )}

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
          title={isAudienceMode ? "송출 창 닫기" : "송출 종료 (Esc)"}
        >
          {isAudienceMode ? "송출 창 닫기" : "송출 종료"}
        </button>
      </div>
    </div>
  );
}
