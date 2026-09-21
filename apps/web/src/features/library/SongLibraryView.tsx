import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Deck, Setlist } from "@repo/shared";
import {
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
  DEFAULT_DECK_STYLE,
  hangulIncludes,
} from "@repo/shared";
import { PresentationCard } from "../presentation/PresentationCard";
import { SlideStage } from "../../components/stage/SlideStage";
import { COMMUNITY_SONGS } from "./mockCommunityData";

export interface SongLibraryViewProps {
  setlist: Setlist;
  onOpenQuickPaste: () => void;
  onAddDeckToSetlist: (deck: Deck) => void;
  onDuplicateSong: (index: number) => void;
  onRemoveSong: (index: number) => void;
  searchQuery?: string;
}

/**
 * '곡 라이브러리' 화면 컴포넌트
 * - 단락 1: 내가 등록한 곡 (My Songs)
 * - 단락 2: 유저가 등록한 곡 (Community Songs)
 */
export function SongLibraryView({
  setlist,
  onOpenQuickPaste,
  onAddDeckToSetlist,
  onDuplicateSong,
  onRemoveSong,
  searchQuery = "",
}: SongLibraryViewProps): React.JSX.Element {
  const navigate = useNavigate();
  const [previewDeck, setPreviewDeck] = useState<Deck | null>(null);
  const [addedDeckId, setAddedDeckId] = useState<string | null>(null);

  // 검색어 필터링 (es-hangul 초성/자모 분해/스마트 한글 검색 지원)
  const query = searchQuery.trim();

  const mySongs = setlist.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!query) return true;
      const deck = item.deck;
      if (!deck) return false;
      return (
        hangulIncludes(deck.title, query) ||
        hangulIncludes(deck.artist, query) ||
        hangulIncludes(deck.lyricsRaw, query)
      );
    });

  const communitySongs = COMMUNITY_SONGS.filter((deck) => {
    if (!query) return true;
    return (
      hangulIncludes(deck.title, query) ||
      hangulIncludes(deck.artist, query) ||
      hangulIncludes(deck.lyricsRaw, query)
    );
  });

  const handleStartPresentation = (): void => {
    navigate("/present/fullscreen");
  };

  const handleOpenEditor = (songIndex?: number): void => {
    if (songIndex !== undefined) {
      navigate(`/editor?song=${songIndex}`);
    } else {
      navigate("/editor");
    }
  };

  const handleAddCommunitySong = (deck: Deck): void => {
    onAddDeckToSetlist(deck);
    setAddedDeckId(deck.id);
    setTimeout(() => {
      setAddedDeckId(null);
    }, 2000);
  };

  return (
    <div className="space-y-10">
      {/* ───────────────────────────────────────────────
          단락 1: 내가 등록한 곡 (My Songs)
          ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-900">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <span>내가 등록한 곡</span>
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-medium">
                {mySongs.length}곡
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              현재 콘티에 등록되어 있거나 직접 가사를 입력하여 생성한 찬양 슬라이드 덱입니다.
            </p>
          </div>

          <button
            type="button"
            data-testid="my-songs-quick-paste-btn"
            onClick={onOpenQuickPaste}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto transition-all"
          >
            <svg
              className="w-4 h-4"
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
            <span>새 찬양 등록 (가사 입력)</span>
          </button>
        </div>

        {mySongs.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center justify-center gap-3 bg-zinc-900/40 border border-zinc-800 rounded-xl">
            <p className="text-sm font-semibold text-zinc-300">
              {query
                ? `"${searchQuery}"에 일치하는 등록 곡이 없습니다.`
                : "등록된 곡이 없습니다."}
            </p>
            {!query && (
              <button
                type="button"
                onClick={onOpenQuickPaste}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-emerald-400 text-xs font-medium cursor-pointer transition-colors"
              >
                가사 입력하여 첫 찬양 등록하기
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {mySongs.map(({ item, index }) => {
              const deck = item.deck;
              if (!deck) return null;

              return (
                <PresentationCard
                  key={item.id}
                  deck={deck}
                  onPresent={handleStartPresentation}
                  onEdit={() => handleOpenEditor(index)}
                  onDuplicate={() => onDuplicateSong(index)}
                  onDelete={() => onRemoveSong(index)}
                />
              );
            })}

            {/* 새 찬양 추가 점선 카드 */}
            <div
              onClick={onOpenQuickPaste}
              className="group border-2 border-dashed border-zinc-800 hover:border-emerald-500/60 rounded-xl flex flex-col items-center justify-center p-8 min-h-[220px] cursor-pointer transition-all bg-zinc-950/40 hover:bg-zinc-900/30"
            >
              <div className="w-11 h-11 rounded-full bg-zinc-900 group-hover:bg-emerald-950/60 border border-zinc-700/80 group-hover:border-emerald-500/50 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors mb-2.5">
                <svg
                  className="w-5 h-5"
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
              <span className="text-xs font-semibold text-zinc-300 group-hover:text-white transition-colors">
                새 찬양 슬라이드 등록
              </span>
              <span className="text-[11px] text-zinc-500 mt-0.5">
                가사 복사 &amp; 자동 슬라이드 생성
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ───────────────────────────────────────────────
          단락 2: 유저가 등록한 곡 (Community Songs)
          ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
              <h2 className="text-xl font-bold text-white tracking-tight">
                유저가 등록한 곡
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono font-medium">
                공유 라이브러리 · {communitySongs.length}곡
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              다른 사역자 및 유저들이 등록하고 검증한 인기 찬양 슬라이드 덱입니다. 원클릭으로 내 콘티에 추가할 수 있습니다.
            </p>
          </div>
        </div>

        {communitySongs.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center justify-center gap-2 bg-zinc-900/40 border border-zinc-800 rounded-xl">
            <p className="text-sm font-semibold text-zinc-300">
              "{searchQuery}"에 일치하는 공유 찬양이 없습니다.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {communitySongs.map((deck) => {
              const leadSlide = deck.slides[0] ?? null;
              const bgUrl = getBackgroundMediaUrl(deck.backgroundId);
              const poster = getBackgroundPosterUrl(deck.backgroundId);
              const isAdded = addedDeckId === deck.id;

              return (
                <div
                  key={deck.id}
                  data-testid={`community-song-card-${deck.id}`}
                  className="group relative flex flex-col bg-zinc-900/60 hover:bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700 rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5"
                >
                  {/* 16:9 슬라이드 썸네일 */}
                  <div
                    className="relative aspect-video w-full bg-black overflow-hidden select-none cursor-pointer rounded-t-2xl"
                    onClick={() => setPreviewDeck(deck)}
                  >
                    <div className="w-full h-full pointer-events-none">
                      <SlideStage
                        slide={leadSlide}
                        style={deck.style ?? DEFAULT_DECK_STYLE}
                        backgroundUrl={bgUrl}
                        posterUrl={poster}
                      />
                    </div>

                    {/* 상단 배지 */}
                    <div className="absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5 pointer-events-none">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-black/80 backdrop-blur-md text-indigo-300 border border-indigo-500/30">
                        공유 곡
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono text-zinc-300 bg-black/70">
                        {deck.slides.length} 슬라이드
                      </span>
                    </div>

                    <div className="absolute top-2.5 right-2.5 z-30 pointer-events-none">
                      <span className="px-1.5 py-0.5 rounded text-[10px] text-zinc-400 bg-black/80 flex items-center gap-1">
                        <svg className="w-3 h-3 fill-current text-indigo-400" viewBox="0 0 24 24">
                          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                        </svg>
                        <span>{deck.forkCount}</span>
                      </span>
                    </div>

                    {/* 호버 오버레이 */}
                    <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 p-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewDeck(deck);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium border border-zinc-600 cursor-pointer shadow-md transition-transform active:scale-95"
                      >
                        가사 미리보기
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddCommunitySong(deck);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md transition-all active:scale-95 flex items-center gap-1 cursor-pointer ${
                          isAdded
                            ? "bg-emerald-600 text-white"
                            : "bg-indigo-600 hover:bg-indigo-500 text-white"
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>추가 완료!</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span>내 콘티에 추가</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 하단 메타데이터 */}
                  <div className="p-4 bg-zinc-900/90 flex items-center justify-between gap-3 border-t border-zinc-800/80">
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">
                        {deck.title}
                      </h4>
                      <p className="text-xs text-zinc-400 truncate mt-0.5">
                        {deck.artist || "찬양 아티스트"}
                      </p>
                    </div>

                    <button
                      type="button"
                      data-testid={`add-community-song-${deck.id}`}
                      onClick={() => handleAddCommunitySong(deck)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                        isAdded
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : "bg-zinc-800 hover:bg-zinc-700 text-indigo-300 hover:text-white border border-zinc-700/80"
                      }`}
                      title="내 콘티에 바로 추가"
                    >
                      {isAdded ? "추가됨 ✓" : "+ 콘티 추가"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 가사 미리보기 모달 */}
      {previewDeck && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-zinc-100">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>{previewDeck.title}</span>
                  <span className="text-xs text-zinc-400 font-normal">
                    {previewDeck.artist}
                  </span>
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  총 {previewDeck.slides.length}개 슬라이드로 구성됨
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPreviewDeck(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {previewDeck.slides.map((slide, idx) => (
                <div
                  key={slide.id}
                  className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex items-start gap-3"
                >
                  <span className="w-6 h-6 rounded-lg bg-zinc-800 text-indigo-400 flex items-center justify-center text-xs font-mono font-bold shrink-0">
                    {idx + 1}
                  </span>
                  <div className="text-xs text-zinc-200 space-y-1 font-medium leading-relaxed">
                    {slide.lines.map((line, lIdx) => (
                      <p key={lIdx}>{line}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-3.5 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setPreviewDeck(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 cursor-pointer"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => {
                  handleAddCommunitySong(previewDeck);
                  setPreviewDeck(null);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-md cursor-pointer"
              >
                내 콘티에 추가하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
