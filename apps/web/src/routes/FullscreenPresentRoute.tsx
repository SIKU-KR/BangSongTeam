import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import { SlideStage } from "../components/stage/SlideStage";
import {
  mockSetlist,
  useNavigationBuffer,
  usePresentationShortcuts,
} from "../features/presentation";

/**
 * M1 청중용 단독 전체화면 송출 라우트
 * - 인메모리 5곡 세트리스트 데이터를 기반으로 완전 오프라인(Zero-Fetch)으로 동작
 * - 3-Layer SlideStage (비디오 루프, 암전/오버레이, 가사 타이포그래피) 송출
 * - 청중 화면에 불필요한 번호 버퍼나 조작 UI를 일절 표시하지 않는 무결점 송출 보장
 * - 키보드(방향키, Space, PgUp/PgDn, B, H, 숫자 키패드 점프) 및 발표자 리모컨 지원
 */
export function FullscreenPresentRoute(): React.JSX.Element {
  const navigate = useNavigate();

  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isBlackout, setIsBlackout] = useState<boolean>(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const songs = mockSetlist.items;
  const currentSong = songs[currentSongIndex]?.deck;
  const currentSlide = currentSong?.slides[currentSlideIndex] ?? null;
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

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

  usePresentationShortcuts({
    onNext: handleNext,
    onPrev: handlePrev,
    onToggleBlackout: () => setIsBlackout((prev) => !prev),
    onToggleLyrics: () => setIsLyricsHidden((prev) => !prev),
    navigationBuffer: navBuffer,
    enabled: true,
  });

  // Fullscreen 상태 모니터링
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch {
      // Fullscreen API may be blocked without user gesture in some contexts
    }
  }, []);

  return (
    <div
      data-testid="fullscreen-present-route"
      className="relative w-screen h-screen overflow-hidden bg-black select-none group"
    >
      {/* 3-Layer Slide Stage: 청중 화면 렌더링 (버퍼 텍스트나 조작 UI 일절 포함 안 됨) */}
      <SlideStage
        slide={currentSlide}
        style={currentStyle}
        isBlackout={isBlackout}
        isLyricsHidden={isLyricsHidden}
      />

      {/* 마우스 호버 시에만 나타나는 우측 상단 최소 제어 도구 (청중 방해 방지) */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-zinc-900/80 backdrop-blur-sm border border-zinc-700/60 rounded-lg px-3 py-1.5 shadow-lg">
        <button
          type="button"
          data-testid="fullscreen-toggle-btn"
          onClick={toggleFullscreen}
          className="text-xs text-zinc-200 hover:text-white px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
          title="전체화면 전환/해제"
        >
          {isFullscreen ? "전체화면 종료" : "전체화면"}
        </button>
        <button
          type="button"
          data-testid="exit-present-btn"
          onClick={() => navigate("/")}
          className="text-xs text-zinc-300 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
          title="메인 홈으로 이동"
        >
          나가기
        </button>
      </div>
    </div>
  );
}
