import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  DEFAULT_DECK_STYLE,
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
} from "@repo/shared";
import { SlideStage } from "../components/stage/SlideStage";
import {
  useActiveSetlist,
  useNavigationBuffer,
  usePresentationShortcuts,
  enterFullscreen,
  exitFullscreen,
} from "../features/presentation";

/**
 * M1 청중용 단독 전체화면 송출 라우트
 * - 인메모리 5곡+ 세트리스트 데이터를 기반으로 완전 오프라인(Zero-Fetch)으로 동작
 * - 3-Layer SlideStage (비디오 루프, 암전/오버레이, 가사 타이포그래피) 송출
 * - 청중 화면에 불필요한 번호 버퍼나 조작 UI를 일절 표시하지 않는 무결점 송출 보장
 * - 키보드(방향키, Space, PgUp/PgDn, B, H, 숫자 키패드 점프) 및 발표자 리모컨 지원
 */
export function FullscreenPresentRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const setlist = useActiveSetlist();

  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isBlackout, setIsBlackout] = useState<boolean>(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const songs = setlist.items;
  const currentSong = songs[currentSongIndex]?.deck;
  const currentSlide = currentSong?.slides[currentSlideIndex] ?? null;
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

  // 배경 영상 및 다음 곡 사전 로드 URL 계산
  const currentBackgroundUrl = getBackgroundMediaUrl(currentSong?.backgroundId);
  const currentPosterUrl = getBackgroundPosterUrl(currentSong?.backgroundId);
  const nextSong = songs[currentSongIndex + 1]?.deck;
  const nextBackgroundUrl = getBackgroundMediaUrl(nextSong?.backgroundId);

  // 다음 슬라이드로 이동 (곡 경계 자동 전환)
  const handleNext = useCallback(() => {
    if (!currentSong) return;

    if (currentSlideIndex < currentSong.slides.length - 1) {
      setCurrentSlideIndex((prev) => prev + 1);
    } else if (currentSongIndex < songs.length - 1) {
      setCurrentSongIndex((prev) => prev + 1);
      setCurrentSlideIndex(0);
    }
  }, [currentSlideIndex, currentSong, currentSongIndex, songs.length]);

  // 이전 슬라이드로 이동 (곡 경계 자동 전환)
  const handlePrev = useCallback(() => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex((prev) => prev - 1);
    } else if (currentSongIndex > 0) {
      const prevSongIndex = currentSongIndex - 1;
      const prevSong = songs[prevSongIndex]?.deck;
      const prevSlideCount = prevSong?.slides.length ?? 1;
      setCurrentSongIndex(prevSongIndex);
      setCurrentSlideIndex(prevSlideCount - 1);
    }
  }, [currentSlideIndex, currentSongIndex, songs]);

  // 숫자 키패드 점프 (N, N., N.M)
  const handleJump = useCallback((songIdx: number, slideIdx: number) => {
    setCurrentSongIndex(songIdx);
    setCurrentSlideIndex(slideIdx);
  }, []);

  const navBuffer = useNavigationBuffer({
    currentSongIndex,
    songCount: songs.length,
    getSlideCount: (idx) => {
      const item = songs[idx];
      return item?.deck ? item.deck.slides.length : 0;
    },
    onJump: handleJump,
  });

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await enterFullscreen();
    } else {
      await exitFullscreen();
    }
  }, []);

  usePresentationShortcuts({
    onNext: handleNext,
    onPrev: handlePrev,
    onToggleBlackout: () => setIsBlackout((prev) => !prev),
    onToggleLyrics: () => setIsLyricsHidden((prev) => !prev),
    onToggleFullscreen: toggleFullscreen,
    navigationBuffer: navBuffer,
    enabled: true,
  });

  // Fullscreen 상태 모니터링 및 마운트 시 자동 전체화면 시도
  useEffect(() => {
    // 자동 전체화면 진입 시도 (PWA 환경 또는 자동 전체화면 권한이 허용된 브라우저 환경)
    if (!document.fullscreenElement) {
      enterFullscreen().catch(() => {});
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const handleExit = useCallback(async () => {
    await exitFullscreen().catch(() => {});
    navigate("/");
  }, [navigate]);

  return (
    <div
      data-testid="fullscreen-present-route"
      onClick={() => {
        if (!isFullscreen) {
          toggleFullscreen();
        }
      }}
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

      {/* 전체화면이 아닐 때 나타나는 클릭-투-전체화면 안내 배너 */}
      {!isFullscreen && (
        <div
          data-testid="fullscreen-prompt-banner"
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-zinc-950/90 hover:bg-zinc-900 text-zinc-100 border border-emerald-500/40 rounded-full shadow-2xl backdrop-blur-md cursor-pointer transition-all hover:scale-105 select-none animate-pulse"
        >
          <svg
            className="w-4 h-4 text-emerald-400 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
          <span className="text-xs font-medium">
            화면을 클릭하면 전체화면으로 전환됩니다
          </span>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-semibold">
            F 키로 전환
          </span>
        </div>
      )}

      {/* 마우스 호버 시에만 나타나는 우측 상단 최소 제어 도구 (청중 방해 방지) */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-zinc-900/80 backdrop-blur-sm border border-zinc-700/60 rounded-lg px-3 py-1.5 shadow-lg">
        <button
          type="button"
          data-testid="fullscreen-toggle-btn"
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          className="text-xs text-zinc-200 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer"
          title="전체화면 전환/해제 (F)"
        >
          {isFullscreen ? "전체화면 종료" : "전체화면"}
        </button>
        <button
          type="button"
          data-testid="exit-present-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleExit();
          }}
          className="text-xs text-zinc-300 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
          title="메인 홈으로 이동"
        >
          나가기
        </button>
      </div>
    </div>
  );
}
