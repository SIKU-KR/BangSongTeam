import React from "react";
import { useNavigate } from "react-router-dom";
import type { Setlist } from "@repo/shared";
import { PresentationCard } from "../presentation/PresentationCard";
import { isGoogleChromeBrowser } from "../../components/common/ChromeAlertBanner";

export interface MergedSlidesViewProps {
  setlist: Setlist;
  onOpenQuickPaste: () => void;
  onCreateNewPresentation: () => void;
  searchQuery?: string;
}

/**
 * 홈 화면: '통합 슬라이드' 1개 단위 뷰
 * - 개별 곡 단위 슬라이드가 아닌, 모든 곡이 하나로 합쳐진 '통합 슬라이드 프레젠테이션' 1개 단위로 렌더링
 * - 16:9 SlideStage 기반 와이드스크린 썸네일과 슬라이드/곡 수 배지 제공
 * - 호버 시 즉각 송출(발표) 및 전체 편집기 진입 지원
 */
export function MergedSlidesView({
  setlist,
  onOpenQuickPaste,
  onCreateNewPresentation,
  searchQuery = "",
}: MergedSlidesViewProps): React.JSX.Element {
  const navigate = useNavigate();

  const totalSlides = setlist.items.reduce(
    (sum, item) => sum + (item.deck?.slides.length ?? 0),
    0,
  );

  const handleStartPresentation = (): void => {
    if (!isGoogleChromeBrowser()) {
      const proceed = window.confirm(
        "이 서비스는 Google Chrome에 최적화되어 있습니다. 예배 송출은 Chrome에서 진행하는 것을 권장합니다.\n\n계속 진행하시겠습니까?",
      );
      if (!proceed) return;
    }
    navigate("/present/fullscreen");
  };

  const handleOpenEditor = (): void => {
    navigate("/editor");
  };

  // 검색어 필터링 (제목 또는 포함된 곡/가사 검색)
  const query = searchQuery.trim().toLowerCase();
  const isMatch =
    !query ||
    setlist.title.toLowerCase().includes(query) ||
    setlist.items.some((item) => {
      const deck = item.deck;
      if (!deck) return false;
      return (
        deck.title.toLowerCase().includes(query) ||
        (deck.artist ?? "").toLowerCase().includes(query) ||
        (deck.lyricsRaw ?? "").toLowerCase().includes(query)
      );
    });

  return (
    <div className="space-y-6">
      {/* 섹션 상단 툴바 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <h2 className="text-xl font-bold text-white tracking-tight">
              통합 슬라이드 프레젠테이션
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-medium">
              1개 프레젠테이션 덱
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            예배 일자: {setlist.serviceDate} · 전체 {setlist.items.length}곡(총 {totalSlides}개 슬라이드)이 순서대로 하나로 합쳐진 16:9 와이드스크린 통합 덱입니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="merged-start-present-btn"
            onClick={handleStartPresentation}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 hover:shadow-emerald-900/60 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>통합 송출 시작하기</span>
          </button>
        </div>
      </div>

      {/* 본문: 통합 슬라이드 1개 단위 카드 그리드 */}
      {!isMatch ? (
        <div className="py-16 text-center flex flex-col items-center justify-center gap-3 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl">
          <p className="text-sm font-semibold text-zinc-300">
            "{searchQuery}"에 일치하는 통합 프레젠테이션이 없습니다.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* 1. 통합 슬라이드 1개 단위 카드 */}
          <PresentationCard
            setlist={setlist}
            onPresent={handleStartPresentation}
            onEdit={handleOpenEditor}
            className="border-emerald-500/50 bg-zinc-900/90 shadow-xl shadow-emerald-950/20 ring-1 ring-emerald-500/30"
          />

          {/* 2. 새 찬양 곡 추가 점선 카드 */}
          <div
            onClick={onOpenQuickPaste}
            className="group border-2 border-dashed border-zinc-800 hover:border-emerald-500/60 rounded-xl flex flex-col items-center justify-center p-8 min-h-[260px] cursor-pointer transition-all bg-zinc-950/40 hover:bg-zinc-900/30"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-900 group-hover:bg-emerald-950/60 border border-zinc-700/80 group-hover:border-emerald-500/50 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors mb-3">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold text-zinc-300 group-hover:text-white transition-colors">
              통합 슬라이드에 곡 추가
            </span>
            <span className="text-xs text-zinc-500 mt-1">
              가사 복사 &amp; 붙여넣기
            </span>
          </div>

          {/* 3. 새 통합 프레젠테이션 만들기 점선 카드 */}
          <div
            onClick={onCreateNewPresentation}
            className="group border-2 border-dashed border-zinc-800 hover:border-indigo-500/60 rounded-xl flex flex-col items-center justify-center p-8 min-h-[260px] cursor-pointer transition-all bg-zinc-950/40 hover:bg-zinc-900/30"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-900 group-hover:bg-indigo-950/60 border border-zinc-700/80 group-hover:border-indigo-500/50 flex items-center justify-center text-zinc-400 group-hover:text-indigo-400 transition-colors mb-3">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold text-zinc-300 group-hover:text-white transition-colors">
              새 통합 프레젠테이션 생성
            </span>
            <span className="text-xs text-zinc-500 mt-1">
              새로운 예배 세트 시작
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
