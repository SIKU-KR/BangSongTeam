import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistenceError } from "../../lib/storage";
import { useSyncStatus } from "../../lib/sync";
import { ThemeMenuButton } from "../../components/common/ThemeMenuButton";

export interface EditorHeaderProps {
  title: string;
  onUpdateTitle: (newTitle: string) => void;
  onPresent: () => void;
  currentSongIndex: number;
  totalSongs: number;
  /** 세트 전체에서 1부터 이어지는 현재 슬라이드 번호 (곡이 바뀌어도 이어진다) */
  currentSlideNumber: number;
  /** 세트 전체 슬라이드 수 */
  totalSlideCount: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onNewPresentation?: () => void;
  onOpenLyricModal?: () => void;
  onLoadSampleSongs?: () => void;
  /** 뒤로가기 목적지 (드라이브에서 이 세트가 들어 있는 폴더) */
  backPath?: string;
  className?: string;
}

/**
 * 편집기 상단 네비게이션 헤더
 * - 뒤로가기 링크 및 파일(File) 메뉴
 * - 세트 제목 인라인 편집
 * - 실행 취소(Undo) / 다시 실행(Redo)
 * - 자동 저장 상태 표시기
 * - 슬라이드 카운터 (세트 전체 연속 번호)
 * - 라이트·다크 테마 전환
 * - 슬라이드쇼 발표(전체화면) CTA 버튼
 */
/**
 * 저장·동기화 상태 표시.
 *
 * 예전에는 데이터 바인딩이 전혀 없는 정적 초록 점 + '자동 저장됨'이었다.
 * 저장이 실패하는 중에도 '저장됨'이라고 말하는 표시는 없느니만 못하다.
 */
function SaveStatusIndicator(): React.JSX.Element {
  const persistenceError = usePersistenceError();
  const { status } = useSyncStatus();

  const { dotClass, label } = (() => {
    if (persistenceError) {
      return { dotClass: "bg-red-500", label: "저장 실패" };
    }
    switch (status) {
      case "syncing":
        return { dotClass: "bg-amber-500", label: "동기화 중…" };
      case "synced":
        return { dotClass: "bg-emerald-500", label: "동기화됨" };
      case "offline":
        // 오프라인은 실패가 아니다. 이 브라우저에는 저장되어 있다.
        return { dotClass: "bg-zinc-400", label: "오프라인 · 로컬 저장됨" };
      case "error":
        return { dotClass: "bg-red-500", label: "동기화 실패" };
      default:
        return { dotClass: "bg-emerald-500", label: "자동 저장됨" };
    }
  })();

  return (
    <span
      data-testid="save-status"
      className="hidden md:inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-medium"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
      {label}
    </span>
  );
}

export function EditorHeader({
  title,
  onUpdateTitle,
  onPresent,
  currentSongIndex,
  totalSongs,
  currentSlideNumber,
  totalSlideCount,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onNewPresentation,
  onOpenLyricModal,
  onLoadSampleSongs,
  backPath = "/presentations",
  className = "",
}: EditorHeaderProps): React.JSX.Element {
  const navigate = useNavigate();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(title);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);

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
      className={`h-14 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800/80 px-4 flex items-center justify-between select-none text-zinc-900 dark:text-zinc-100 ${className}`}
    >
      {/* 1. 좌측: 뒤로가기 & 세트 제목 & 실행취소/다시실행 */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          data-testid="header-back-btn"
          onClick={() => navigate(backPath)}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1 text-xs cursor-pointer"
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

        {/* Canva 스타일 파일 메뉴 */}
        <div className="relative">
          <button
            type="button"
            data-testid="header-file-menu-btn"
            onClick={() => setShowFileMenu((prev) => !prev)}
            className="px-2 py-1 rounded text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1 cursor-pointer font-medium"
          >
            <span>파일</span>
            <svg
              className="w-3 h-3 text-zinc-400 dark:text-zinc-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showFileMenu && (
            <div className="absolute left-0 top-9 z-50 w-52 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg dark:shadow-2xl text-xs space-y-0.5 font-sans">
              {onNewPresentation && (
                <button
                  type="button"
                  onClick={() => {
                    setShowFileMenu(false);
                    onNewPresentation();
                  }}
                  className="w-full px-3 py-2 text-left text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                >
                  <svg
                    className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"
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
                  <span>새 프레젠테이션</span>
                </button>
              )}
              {onOpenLyricModal && (
                <button
                  type="button"
                  onClick={() => {
                    setShowFileMenu(false);
                    onOpenLyricModal();
                  }}
                  className="w-full px-3 py-2 text-left text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                >
                  <svg
                    className="w-3.5 h-3.5 text-indigo-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span>가사 빠른 입력</span>
                </button>
              )}
              {onLoadSampleSongs && (
                <button
                  type="button"
                  onClick={() => {
                    setShowFileMenu(false);
                    onLoadSampleSongs();
                  }}
                  className="w-full px-3 py-2 text-left text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                >
                  <svg
                    className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span>기본 5곡 세트 불러오기</span>
                </button>
              )}
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <button
                type="button"
                onClick={() => {
                  setShowFileMenu(false);
                  onPresent();
                }}
                className="w-full px-3 py-2 text-left text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-2 cursor-pointer font-medium"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>슬라이드쇼 발표</span>
              </button>
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

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
              className="bg-white dark:bg-zinc-900 border border-emerald-500 rounded px-2 py-0.5 text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTempTitle(title);
                setIsEditingTitle(true);
              }}
              className="text-sm font-bold text-zinc-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors truncate max-w-xs sm:max-w-md flex items-center gap-1.5 cursor-pointer text-left"
              title="클릭하여 제목 수정"
            >
              <span className="truncate">{title}</span>
              <svg
                className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0"
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

          {/* 저장·동기화 상태 */}
          <SaveStatusIndicator />
        </div>

        {/* Undo / Redo */}
        {(onUndo || onRedo) && (
          <div className="hidden sm:flex items-center gap-0.5 border-l border-zinc-200 dark:border-zinc-800 pl-2">
            <button
              type="button"
              data-testid="header-undo-btn"
              disabled={!canUndo}
              onClick={onUndo}
              className="p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 transition-colors cursor-pointer"
              title="실행 취소 (Undo)"
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
                  d="M3 10h10a5 5 0 015 5v2M3 10l6-6M3 10l6 6"
                />
              </svg>
            </button>
            <button
              type="button"
              data-testid="header-redo-btn"
              disabled={!canRedo}
              onClick={onRedo}
              className="p-1.5 rounded text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-25 transition-colors cursor-pointer"
              title="다시 실행 (Redo)"
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
                  d="M21 10H11a5 5 0 00-5 5v2M21 10l-6-6M21 10l-6 6"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* 2. 중앙: 슬라이드 위치 표시기 */}
      <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 font-mono">
        {totalSongs > 0 ? (
          <>
            <span>
              곡 {currentSongIndex + 1}/{totalSongs}
            </span>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span>
              슬라이드 {currentSlideNumber}/{totalSlideCount}
            </span>
          </>
        ) : (
          <span>곡 없음 · 0개 슬라이드</span>
        )}
      </div>

      {/* 3. 우측: 단축키 안내 및 슬라이드쇼 발표 버튼 */}
      <div className="flex items-center gap-2 shrink-0">
        {/* 단축키 토글 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowShortcuts((prev) => !prev)}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-xs flex items-center gap-1 cursor-pointer"
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
            <div className="absolute right-0 top-10 z-50 w-64 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg dark:shadow-2xl text-xs space-y-2 font-mono">
              <div className="font-bold text-zinc-900 dark:text-white font-sans text-xs pb-1 border-b border-zinc-200 dark:border-zinc-800">
                발표 송출 단축키
              </div>
              <div className="flex justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-400">
                  다음/이전 슬라이드
                </span>
                <span>Space, ▶ / ◀</span>
              </div>
              <div className="flex justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-400">
                  암전 (Blackout)
                </span>
                <span>B</span>
              </div>
              <div className="flex justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-400">
                  가사 숨김
                </span>
                <span>H</span>
              </div>
              <div className="flex justify-between text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-400">
                  슬라이드 번호 이동
                </span>
                <span>번호 + Enter</span>
              </div>
            </div>
          )}
        </div>

        {/* 라이트·다크 테마 전환 */}
        <ThemeMenuButton variant="compact" direction="down" align="right" />

        {/* 슬라이드쇼 발표 CTA 버튼 */}
        <button
          type="button"
          data-testid="header-present-btn"
          disabled={totalSongs === 0}
          onClick={onPresent}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs transition-all shadow-sm dark:shadow-md dark:shadow-emerald-950/50 dark:hover:shadow-emerald-900/60 flex items-center gap-1.5 cursor-pointer"
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
