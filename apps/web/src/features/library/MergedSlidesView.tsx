import React from "react";
import { useNavigate } from "react-router-dom";
import type { Setlist, Slide, Deck } from "@repo/shared";
import {
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
  DEFAULT_DECK_STYLE,
} from "@repo/shared";
import { SlideStage } from "../../components/stage/SlideStage";
import { isGoogleChromeBrowser } from "../../components/common/ChromeAlertBanner";

export interface MergedSlidesViewProps {
  setlist: Setlist;
  onOpenQuickPaste: () => void;
  searchQuery?: string;
}

interface FlattenedSlideItem {
  globalIndex: number;
  songIndex: number;
  slideIndexInSong: number;
  slide: Slide;
  deck: Deck;
}

/**
 * 홈 전용 '합쳐진 슬라이드' 뷰 컴포넌트
 * - 세트리스트 내 모든 곡의 슬라이드를 하나의 연속된 슬라이드 시퀀스로 통합 렌더링
 * - 16:9 SlideStage 썸네일과 곡명/슬라이드 번호 라벨 제공
 * - 슬라이드 클릭 시 해당 곡/슬라이드로 편집기 진입 및 상단 전체 송출(발표) 액션 제공
 */
export function MergedSlidesView({
  setlist,
  onOpenQuickPaste,
  searchQuery = "",
}: MergedSlidesViewProps): React.JSX.Element {
  const navigate = useNavigate();

  // 모든 곡의 슬라이드를 하나의 연속된 시퀀스로 평탄화
  const allMergedSlides: FlattenedSlideItem[] = [];
  let currentGlobalIndex = 0;

  for (let sIdx = 0; sIdx < setlist.items.length; sIdx++) {
    const item = setlist.items[sIdx];
    const deck = item.deck;
    if (!deck) continue;

    for (let slIdx = 0; slIdx < deck.slides.length; slIdx++) {
      allMergedSlides.push({
        globalIndex: currentGlobalIndex + 1,
        songIndex: sIdx,
        slideIndexInSong: slIdx,
        slide: deck.slides[slIdx],
        deck,
      });
      currentGlobalIndex++;
    }
  }

  // 검색어 필터링 (곡 제목 또는 슬라이드 가사 내용)
  const filteredSlides = allMergedSlides.filter((item) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const songMatch = item.deck.title.toLowerCase().includes(query);
    const lyricsMatch = item.slide.lines.some((line) =>
      line.toLowerCase().includes(query),
    );
    return songMatch || lyricsMatch;
  });

  const handleStartPresentation = (): void => {
    if (!isGoogleChromeBrowser()) {
      const proceed = window.confirm(
        "이 서비스는 Google Chrome에 최적화되어 있습니다. 예배 송출은 Chrome에서 진행하는 것을 권장합니다.\n\n계속 진행하시겠습니까?",
      );
      if (!proceed) return;
    }
    navigate("/present/fullscreen");
  };

  const handleOpenEditor = (songIndex: number): void => {
    navigate(`/editor?song=${songIndex}`);
  };

  return (
    <div className="space-y-6">
      {/* 1. 상단 통합 프레젠테이션 헤더 카드 */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-900 border border-zinc-800/90 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/80 text-xs font-semibold">
              통합 슬라이드
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-xs font-medium">
              {setlist.items.length}곡 구성
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/60 text-xs font-mono font-medium">
              총 {allMergedSlides.length}개 슬라이드
            </span>
          </div>

          <h2 className="text-2xl font-black text-white tracking-tight">
            {setlist.title}
          </h2>

          <p className="text-xs text-zinc-400 flex items-center gap-2">
            <span>예배 일자: {setlist.serviceDate}</span>
            <span className="text-zinc-600">·</span>
            <span>16:9 와이드스크린 무중단 비디오 루프</span>
          </p>
        </div>

        {/* 상단 퀵 액션 */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="merged-open-quick-paste-btn"
            onClick={onOpenQuickPaste}
            className="px-3.5 py-2.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all shadow-sm"
          >
            <svg
              className="w-4 h-4 text-emerald-400"
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
            <span>곡 추가 (가사 입력)</span>
          </button>

          <button
            type="button"
            data-testid="merged-open-editor-btn"
            onClick={() => handleOpenEditor(0)}
            className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold border border-zinc-700 flex items-center gap-2 cursor-pointer transition-all shadow-sm"
          >
            <svg
              className="w-4 h-4 text-indigo-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span>편집기에서 열기</span>
          </button>

          <button
            type="button"
            data-testid="merged-start-present-btn"
            onClick={handleStartPresentation}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-lg shadow-emerald-950/60 hover:shadow-emerald-900/80 active:scale-95"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>통합 송출 시작하기</span>
          </button>
        </div>
      </div>

      {/* 2. 본문: 합쳐진 슬라이드 시퀀스 목록 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>합쳐진 슬라이드 전체 목록</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-emerald-400 font-mono">
                {filteredSlides.length} / {allMergedSlides.length}
              </span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              찬양 순서에 따라 연결된 모든 슬라이드입니다. 슬라이드를 클릭하면
              해당 위치 편집기로 이동합니다.
            </p>
          </div>
        </div>

        {/* 빈 상태 */}
        {allMergedSlides.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-4 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-500">
              <svg
                className="w-7 h-7"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-300">
                현재 등록된 슬라이드가 없습니다.
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                찬양 가사를 입력하거나 곡 라이브러리에서 곡을 추가하세요.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenQuickPaste}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition-colors shadow-sm"
            >
              가사 입력하여 슬라이드 만들기
            </button>
          </div>
        ) : filteredSlides.length === 0 && searchQuery ? (
          <div className="py-16 text-center flex flex-col items-center justify-center gap-3 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl">
            <p className="text-sm font-semibold text-zinc-300">
              "{searchQuery}"에 일치하는 슬라이드가 없습니다.
            </p>
          </div>
        ) : (
          /* 16:9 슬라이드 카드 그리드 */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filteredSlides.map((item) => {
              const bgId = item.deck.backgroundId;
              const bgUrl = getBackgroundMediaUrl(bgId);
              const poster = getBackgroundPosterUrl(bgId);
              const style = item.deck.style ?? DEFAULT_DECK_STYLE;

              return (
                <div
                  key={`${item.deck.id}_${item.slide.id}`}
                  data-testid={`merged-slide-card-${item.globalIndex}`}
                  onClick={() => handleOpenEditor(item.songIndex)}
                  className="group relative flex flex-col bg-zinc-900/70 border border-zinc-800/80 hover:border-emerald-500/60 rounded-xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-xl hover:shadow-emerald-950/20"
                >
                  {/* 16:9 슬라이드 미리보기 스테이지 */}
                  <div className="relative aspect-video w-full bg-black overflow-hidden select-none">
                    <div className="w-full h-full pointer-events-none">
                      <SlideStage
                        slide={item.slide}
                        style={style}
                        backgroundUrl={bgUrl}
                        posterUrl={poster}
                      />
                    </div>

                    {/* 상단 라벨 배지 */}
                    <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5 pointer-events-none">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-black/80 backdrop-blur-md text-emerald-400 border border-emerald-500/40">
                        #{item.globalIndex}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-black/80 backdrop-blur-md text-zinc-200 border border-zinc-700/50 truncate max-w-[120px]">
                        {item.deck.title}
                      </span>
                    </div>

                    <div className="absolute top-2 right-2 z-30 pointer-events-none">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-black/70">
                        곡 {item.songIndex + 1} - {item.slideIndexInSong + 1}
                      </span>
                    </div>

                    {/* 마우스 호버 시 퀵 액션 오버레이 */}
                    <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 p-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEditor(item.songIndex);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium border border-zinc-600/60 transition-transform active:scale-95 cursor-pointer shadow-md"
                      >
                        편집하기
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartPresentation();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-transform active:scale-95 cursor-pointer shadow-md flex items-center gap-1"
                      >
                        <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        <span>송출</span>
                      </button>
                    </div>
                  </div>

                  {/* 하단 가사 텍스트 요약 */}
                  <div className="p-3 bg-zinc-900/90 border-t border-zinc-800/80 flex flex-col justify-between flex-1">
                    <p className="text-xs text-zinc-300 font-medium line-clamp-2 leading-relaxed">
                      {item.slide.lines.join(" / ") || "(빈 슬라이드)"}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="truncate">{item.deck.artist || "찬양 곡"}</span>
                      <span className="font-mono text-emerald-400/80 text-[10px]">
                        16:9 HD
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
