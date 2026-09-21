import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export interface EditorHeaderProps {
  title: string;
  onUpdateTitle: (newTitle: string) => void;
  onPresent: () => void;
  currentSongIndex: number;
  totalSongs: number;
  currentSlideIndex: number;
  totalSlides: number;
  className?: string;
}

/**
 * Canva / MiriCanvas 스타일 편집기 상단 네비게이션 헤더
 * - 뒤로가기 링크
 * - 세트 제목 인라인 편집
 * - 자동 저장 상태 표시기
 * - 슬라이드 카운터
 * - 슬라이드쇼 발표(전체화면) CTA 버튼
 */
export function EditorHeader({
  title,
  onUpdateTitle,
  onPresent,
  currentSongIndex,
  totalSongs,
  currentSlideIndex,
  totalSlides,
  className = "",
}: EditorHeaderProps): React.JSX.Element {
  const navigate = useNavigate();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(title);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (tempTitle.trim() && tempTitle !== title) {
      onUpdateTitle(tempTitle.trim());
    } else {
      setTempTitle(title);
    }
  };

  return (
    <header
      data-testid="editor-header"
      className={`h-14 bg-zinc-950 border-b border-zinc-800/80 px-4 flex items-center justify-between select-none text-zinc-100 ${className}`}
    >
      {/* 1. 좌측: 뒤로가기 & 세트 제목 */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          data-testid="header-back-btn"
          onClick={() => navigate("/")}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-1 text-xs cursor-pointer"
          title="프레젠테이션 목록으로 돌아가기"
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
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          <span className="hidden sm:inline">홈</span>
        </button>

        <div className="h-4 w-px bg-zinc-800" />

        {/* 인라인 제목 편집 */}
        <div className="flex items-center gap-2 min-w-0">
          {isEditingTitle ? (
            <input
              type="text"
              value={tempTitle}
              autoFocus
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTitleSubmit();
                if (e.key === "Escape") {
                  setIsEditingTitle(false);
                  setTempTitle(title);
                }
              }}
              className="bg-zinc-900 border border-emerald-500 rounded px-2 py-0.5 text-sm font-semibold text-white focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTempTitle(title);
                setIsEditingTitle(true);
              }}
              className="text-sm font-bold text-white hover:text-emerald-400 transition-colors truncate max-w-xs sm:max-w-md flex items-center gap-1.5 cursor-pointer text-left"
              title="클릭하여 제목 수정"
            >
              <span className="truncate">{title}</span>
              <svg
                className="w-3.5 h-3.5 text-zinc-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
          )}

          {/* 저장 상태 */}
          <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-zinc-500 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            자동 저장됨
          </span>
        </div>
      </div>

      {/* 2. 중앙: 슬라이드 위치 표시기 */}
      <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 font-mono">
        <span>
          곡 {currentSongIndex + 1}/{totalSongs}
        </span>
        <span className="text-zinc-600">·</span>
        <span>
          슬라이드 {currentSlideIndex + 1}/{totalSlides}
        </span>
      </div>

      {/* 3. 우측: 단축키 안내 및 슬라이드쇼 발표 버튼 */}
      <div className="flex items-center gap-2 shrink-0">
        {/* 단축키 토글 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowShortcuts((prev) => !prev)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-xs flex items-center gap-1 cursor-pointer"
            title="송출 단축키 안내"
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
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="hidden sm:inline">단축키</span>
          </button>

          {showShortcuts && (
            <div className="absolute right-0 top-10 z-50 w-64 p-3 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl text-xs space-y-2 font-mono">
              <div className="font-bold text-white font-sans text-xs pb-1 border-b border-zinc-800">
                발표 송출 단축키
              </div>
              <div className="flex justify-between text-zinc-300">
                <span className="text-zinc-500">다음/이전 슬라이드</span>
                <span>Space, ▶ / ◀</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span className="text-zinc-500">암전 (Blackout)</span>
                <span>B</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span className="text-zinc-500">가사 숨김</span>
                <span>H</span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span className="text-zinc-500">곡/슬라이드 점프</span>
                <span>N.M + Enter</span>
              </div>
            </div>
          )}
        </div>

        {/* Canva 스타일 발표 CTA 버튼 */}
        <button
          type="button"
          data-testid="header-present-btn"
          onClick={onPresent}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all shadow-md shadow-emerald-950/50 hover:shadow-emerald-900/60 flex items-center gap-1.5 cursor-pointer"
        >
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span>슬라이드쇼 발표</span>
        </button>
      </div>
    </header>
  );
}
