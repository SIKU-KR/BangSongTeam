import React, { useState, useMemo, useEffect } from "react";
import type { Deck } from "@repo/shared";
import { hangulIncludes, splitLyricsIntoSlides } from "@repo/shared";
import { ExternalSearchLinks } from "./ExternalSearchLinks";
import {
  useAvailableSongs,
  saveSongToLibrary,
  type AvailableSongItem,
} from "./songLibraryStore";

export interface SongPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSong: (deck: Deck) => void;
  initialSearch?: string;
}

type FilterType = "all" | "mine" | "community";
type Mode = "browse" | "create";

export function SongPickerModal({
  isOpen,
  onClose,
  onSelectSong,
  initialSearch = "",
}: SongPickerModalProps): React.JSX.Element | null {
  const availableSongs = useAvailableSongs();

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [filter, setFilter] = useState<FilterType>("all");
  const [mode, setMode] = useState<Mode>("browse");
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 직접 등록 폼 상태
  const [newTitle, setNewTitle] = useState("");
  const [newArtist, setNewArtist] = useState("");
  const [newLyrics, setNewLyrics] = useState("");

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(initialSearch);
      setMode("browse");
      setCopied(false);
      // 첫 번째 항목 기본 선택
      if (availableSongs.length > 0 && !selectedSongId) {
        setSelectedSongId(availableSongs[0].deck.id);
      }
    }
  }, [isOpen, initialSearch, availableSongs, selectedSongId]);

  // ESC 키로 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // 검색 및 필터링
  const filteredSongs = useMemo(() => {
    const q = searchQuery.trim();
    return availableSongs.filter((item) => {
      if (filter === "mine" && item.source !== "mine") return false;
      if (filter === "community" && item.source !== "community") return false;
      if (!q) return true;

      const deck = item.deck;
      const matchesMeta =
        hangulIncludes(deck.title, q) || hangulIncludes(deck.artist ?? "", q);

      // 곡 제목·아티스트 또는 가사 본문으로 검색
      return matchesMeta || hangulIncludes(deck.lyricsRaw ?? "", q);
    });
  }, [availableSongs, searchQuery, filter]);

  // 현재 선택된 곡 계산
  const selectedSongItem: AvailableSongItem | undefined = useMemo(() => {
    if (!selectedSongId) return filteredSongs[0];
    return (
      filteredSongs.find((item) => item.deck.id === selectedSongId) ??
      filteredSongs[0]
    );
  }, [filteredSongs, selectedSongId]);

  // 선택 유효성 보정
  useEffect(() => {
    if (
      filteredSongs.length > 0 &&
      (!selectedSongItem ||
        !filteredSongs.some((s) => s.deck.id === selectedSongId))
    ) {
      setSelectedSongId(filteredSongs[0].deck.id);
    }
  }, [filteredSongs, selectedSongId, selectedSongItem]);

  // 새 곡 분할 슬라이드 계산
  const previewSlides = useMemo(() => {
    if (!newLyrics.trim()) return [];
    return splitLyricsIntoSlides(newLyrics);
  }, [newLyrics]);

  const isCreateValid = newTitle.trim().length > 0 && previewSlides.length > 0;

  if (!isOpen) return null;

  // 곡 가사 복사
  const handleCopyLyrics = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 기존 곡 선택하여 세트에 추가
  const handleAddSelectedSong = () => {
    if (!selectedSongItem) return;
    onSelectSong(selectedSongItem.deck);
    onClose();
  };

  // 새 곡 등록 및 세트에 추가
  const handleCreateAndAdd = () => {
    if (!isCreateValid) return;
    const saved = saveSongToLibrary({
      title: newTitle.trim(),
      artist: newArtist.trim(),
      lyricsRaw: newLyrics,
    });
    onSelectSong(saved);
    // 폼 초기화 후 닫기
    setNewTitle("");
    setNewArtist("");
    setNewLyrics("");
    onClose();
  };

  // 원문 가사 줄 및 분할선 렌더링을 위한 파싱 (내 곡 및 공유 찬양 모두 전문 표시)
  const rawLines = !selectedSongItem
    ? []
    : selectedSongItem.deck.lyricsRaw.split("\n");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="song-picker-title"
      data-testid="song-picker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative flex flex-col w-full max-w-5xl h-[88vh] max-h-[850px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100">
        {/* 모달 상단 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/90 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h2
                id="song-picker-title"
                className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white tracking-tight"
              >
                찬양곡 추가
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono">
                라이브러리 {availableSongs.length}곡
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              보관된 찬양 가사를 검색하여 세트에 추가하거나, 새 가사를 직접
              입력할 수 있습니다.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 모달 2-Pane 본문 */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* ────────────────────────────────────────────────────────
              좌측 패널: 찬양곡 검색 및 컴팩트 목록
              ──────────────────────────────────────────────────────── */}
          <div className="w-full md:w-5/12 lg:w-4/12 flex flex-col border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 shrink-0 bg-white dark:bg-zinc-900">
            {/* 검색 및 액션 바 */}
            <div className="p-3.5 space-y-2.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  data-testid="song-picker-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="곡 제목, 아티스트, 가사 검색..."
                  className="w-full pl-9 pr-8 py-2 text-xs bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <svg
                  className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* 필터 칩 + 새 곡 등록 버튼 */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="song-picker-filter-all"
                    onClick={() => setFilter("all")}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      filter === "all"
                        ? "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    data-testid="song-picker-filter-mine"
                    onClick={() => setFilter("mine")}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      filter === "mine"
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    내 곡
                  </button>
                  <button
                    type="button"
                    data-testid="song-picker-filter-community"
                    onClick={() => setFilter("community")}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      filter === "community"
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    공유 곡
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="song-picker-switch-create-btn"
                  onClick={() => {
                    setMode(mode === "create" ? "browse" : "create");
                    if (mode !== "create" && searchQuery) {
                      setNewTitle(searchQuery);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                    mode === "create"
                      ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                      : "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                  }`}
                >
                  <span>
                    {mode === "create" ? "← 목록 보기" : "+ 새 가사 입력"}
                  </span>
                </button>
              </div>
            </div>

            {/* 곡 목록 (컴팩트 리스트) */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {filteredSongs.length === 0 ? (
                <div className="p-8 text-center flex flex-col items-center justify-center gap-2.5 text-zinc-500">
                  <p className="text-xs">일치하는 찬양곡이 없습니다.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("create");
                      setNewTitle(searchQuery);
                    }}
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer font-medium"
                  >
                    + '{searchQuery}' 새 곡으로 직접 등록하기
                  </button>
                </div>
              ) : (
                filteredSongs.map(({ deck, source }) => {
                  const isSelected = selectedSongItem?.deck.id === deck.id;
                  // 첫 소절 스니펫 추출
                  const firstSnippet =
                    deck.slides[0]?.lines.filter(Boolean).join(" ") ||
                    deck.lyricsRaw.split("\n").filter(Boolean)[0] ||
                    "";

                  return (
                    <div
                      key={deck.id}
                      data-testid={`song-item-${deck.id}`}
                      onClick={() => {
                        setSelectedSongId(deck.id);
                        if (mode === "create") setMode("browse");
                      }}
                      className={`p-3.5 cursor-pointer transition-colors flex flex-col gap-1 select-none ${
                        isSelected && mode === "browse"
                          ? "bg-emerald-50/70 dark:bg-emerald-950/40 border-l-4 border-emerald-500 pl-2.5"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                          {deck.title}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              source === "mine"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                            }`}
                          >
                            {source === "mine" ? "내 보관함" : "공유"}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {deck.slides.length}슬라이드
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span className="truncate">
                          {deck.artist || "아티스트 미상"}
                        </span>
                      </div>

                      {firstSnippet && (
                        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5 font-light">
                          {firstSnippet}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ────────────────────────────────────────────────────────
              우측 패널: 가사 원문 검토 or 새 찬양 직접 입력
              ──────────────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0 bg-zinc-50/60 dark:bg-zinc-950/40">
            {mode === "create" ? (
              /* 새 찬양 직접 입력 폼 */
              <div className="flex-1 flex flex-col p-6 overflow-y-auto space-y-4">
                <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                    새 찬양 가사 직접 입력
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    가사를 입력하면 빈 줄(엔터 2번) 기준으로 슬라이드가 자동
                    분할됩니다. (슬라이드당 최대 4줄)
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                      곡 제목 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      data-testid="song-picker-create-title-input"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="예: 시간을 뚫고"
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                      아티스트 (선택)
                    </label>
                    <input
                      type="text"
                      data-testid="song-picker-create-artist-input"
                      value={newArtist}
                      onChange={(e) => setNewArtist(e.target.value)}
                      placeholder="예: WELOVE"
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {newTitle.trim() && (
                  <div className="pt-1">
                    <ExternalSearchLinks title={newTitle} />
                  </div>
                )}

                <div className="flex-1 flex flex-col min-h-[220px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      가사 원문 붙여넣기{" "}
                      <span className="text-rose-500">*</span>
                    </label>
                    {previewSlides.length > 0 && (
                      <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {previewSlides.length}개 슬라이드로 자동 분할됨
                      </span>
                    )}
                  </div>
                  <textarea
                    data-testid="song-picker-create-lyrics-input"
                    value={newLyrics}
                    onChange={(e) => setNewLyrics(e.target.value)}
                    placeholder="당신은 시간을 뚫고&#10;이 땅 가운데 오셨네&#10;&#10;우리 없는 하늘을 원치 않아&#10;우리 삶에 오셨네"
                    className="flex-1 w-full p-4 text-xs font-mono leading-relaxed bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setMode("browse")}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    data-testid="song-picker-create-submit-btn"
                    disabled={!isCreateValid}
                    onClick={handleCreateAndAdd}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>보관함에 저장하고 프레젠테이션에 추가</span>
                  </button>
                </div>
              </div>
            ) : selectedSongItem ? (
              /* 곡 원문 텍스트 뷰어 (Browse Mode) */
              <div className="flex-1 flex flex-col min-h-0">
                {/* 상단 메타데이터 바 */}
                <div className="p-5 border-b border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                        {selectedSongItem.deck.title}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          selectedSongItem.source === "mine"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                        }`}
                      >
                        {selectedSongItem.source === "mine"
                          ? "내 보관함"
                          : "공유 찬양"}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {selectedSongItem.deck.artist || "아티스트 미상"} · 총{" "}
                      {selectedSongItem.deck.slides.length}개 슬라이드(소절)
                    </p>
                  </div>

                  <ExternalSearchLinks title={selectedSongItem.deck.title} />
                </div>

                {/* 순수 원문 텍스트 뷰어 (줄 번호 + 슬라이드 분할 구분선) */}
                <div className="flex-1 overflow-y-auto p-5 font-mono text-xs">
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm space-y-0.5">
                    {rawLines.map((line, idx) => {
                      const isBlank = !line.trim();

                      if (isBlank) {
                        return (
                          <div
                            key={idx}
                            className="flex items-center gap-3 py-2 my-1"
                          >
                            <span className="w-8 text-right text-[10px] text-zinc-300 dark:text-zinc-700 select-none">
                              {idx + 1}
                            </span>
                            <div className="flex-1 border-b border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-end">
                              <span className="text-[9px] text-zinc-400 dark:text-zinc-600 px-1 font-sans">
                                [슬라이드 분할]
                              </span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={idx}
                          className="flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded px-1 -mx-1"
                        >
                          <span className="w-8 text-right text-[11px] text-zinc-400 dark:text-zinc-600 select-none shrink-0 pt-0.5">
                            {idx + 1}
                          </span>
                          <span className="text-zinc-800 dark:text-zinc-200 font-sans text-xs leading-relaxed">
                            {line}
                          </span>
                        </div>
                      );
                    })}

                  </div>
                </div>

                {/* 하단 CTA 바 */}
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between shrink-0">
                  <button
                    type="button"
                    data-testid="song-picker-copy-lyrics-btn"
                    onClick={() =>
                      handleCopyLyrics(selectedSongItem.deck.lyricsRaw)
                    }
                    className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    <span>
                      {copied ? "가사 복사됨 ✓" : "가사 텍스트 복사"}
                    </span>
                  </button>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      닫기
                    </button>
                    <button
                      type="button"
                      data-testid="song-picker-add-btn"
                      onClick={handleAddSelectedSong}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
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
                      <span>이 곡을 프레젠테이션에 추가</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs">
                곡을 선택해주세요.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
