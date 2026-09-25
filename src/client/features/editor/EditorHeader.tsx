import React, { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistenceError } from "../../lib/storage";
import { useSyncStatus } from "../../lib/sync";
import { ThemeMenuButton } from "../../components/common/ThemeMenuButton";
import { PRESENTATION_SHORTCUTS } from "#shared";
import { useDismiss } from "../../hooks/useDismiss";
import { EDITOR_SHORTCUT_GUIDE } from "./editorShortcuts";

const PRESENTATION_SHORTCUT_GUIDE: ReadonlyArray<{
  keys: string;
  action: string;
}> = [
  { keys: "→ / Space / PageDown", action: "다음 슬라이드" },
  { keys: "← / PageUp", action: "이전 슬라이드" },
  { keys: "번호 + Enter", action: "세트 전체 N번째 슬라이드로 이동" },
  { keys: "Backspace", action: "입력 중인 마지막 숫자 지우기" },
  { keys: "B", action: "블랙아웃 켜기/끄기" },
  { keys: "H", action: "가사 숨기기 (배경 유지)" },
  { keys: "Esc", action: "전체화면 해제 (송출 종료)" },
];

const NUMBER_JUMP_RULES: ReadonlyArray<string> = [
  "번호는 곡이 바뀌어도 이어서 셉니다. 1곡이 5장이면 2곡 첫 장은 6번입니다.",
  "숫자를 입력한 뒤 Enter를 눌러야 이동합니다.",
  `${PRESENTATION_SHORTCUTS.BUFFER_CLEAR_TIMEOUT_MS / 1000}초 동안 입력이 없으면 입력한 번호가 지워집니다.`,
  "없는 번호는 무시합니다.",
  "입력 중인 번호는 청중 화면에 표시되지 않습니다.",
];

export interface EditorHeaderProps {
  title: string;
  onUpdateTitle: (newTitle: string) => void;
  onPresent: () => void;
  totalSongs: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onNewPresentation?: () => void;
  onOpenLyricModal?: () => void;
  backPath?: string;
  className?: string;
}

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
      className="hidden items-center gap-1 text-[11px] font-medium text-zinc-500 md:inline-flex dark:text-zinc-400"
    >
      <span className={`size-1.5 rounded-full ${dotClass}`}></span>
      {label}
    </span>
  );
}

function ShortcutTable({
  heading,
  rows,
}: {
  heading: string;
  rows: ReadonlyArray<{ keys: string; action: string }>;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="border-b border-zinc-200 pb-1 text-xs font-bold text-zinc-900 dark:border-zinc-800 dark:text-white">
        {heading}
      </div>
      <table className="w-full">
        <tbody>
          {rows.map(({ keys, action }) => (
            <tr key={action}>
              <th
                scope="row"
                className="py-0.5 pr-3 text-left align-top font-mono font-normal whitespace-nowrap text-zinc-700 dark:text-zinc-300"
              >
                {keys}
              </th>
              <td className="py-0.5 text-zinc-500 dark:text-zinc-400">
                {action}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 편집기 상단 네비게이션 헤더.
 */
export function EditorHeader({
  title,
  onUpdateTitle,
  onPresent,
  totalSongs,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onNewPresentation,
  onOpenLyricModal,
  backPath = "/presentations",
  className = "",
}: EditorHeaderProps): React.JSX.Element {
  const navigate = useNavigate();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(title);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);

  const closeFileMenu = useCallback(() => setShowFileMenu(false), []);
  const closeShortcuts = useCallback(() => setShowShortcuts(false), []);
  useDismiss(fileMenuRef, showFileMenu, closeFileMenu);
  useDismiss(shortcutsRef, showShortcuts, closeShortcuts);

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
      className={`flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 text-zinc-900 select-none dark:border-zinc-800/80 dark:bg-zinc-950 dark:text-zinc-100 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          data-testid="header-back-btn"
          onClick={() => navigate(backPath)}
          className="flex cursor-pointer items-center gap-1 rounded-lg p-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          title="프레젠테이션 목록으로 돌아가기"
        >
          <svg
            className="size-4"
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

        <div ref={fileMenuRef} className="relative">
          <button
            type="button"
            data-testid="header-file-menu-btn"
            aria-haspopup="menu"
            aria-expanded={showFileMenu}
            onClick={() => setShowFileMenu((prev) => !prev)}
            className="flex cursor-pointer items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <span>파일</span>
            <svg
              className="size-3 text-zinc-400 dark:text-zinc-500"
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
            <div
              role="menu"
              data-testid="header-file-menu-dropdown"
              className="absolute top-9 left-0 z-50 w-52 space-y-0.5 rounded-xl border border-zinc-200 bg-white py-1.5 font-sans text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-2xl"
            >
              {onNewPresentation && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowFileMenu(false);
                    onNewPresentation();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                  <svg
                    className="size-3.5 text-emerald-600 dark:text-emerald-400"
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
                  role="menuitem"
                  data-testid="header-file-menu-lyric-btn"
                  onClick={() => {
                    setShowFileMenu(false);
                    onOpenLyricModal();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                  <svg
                    className="size-3.5 text-indigo-400"
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
                  <span>새 가사 입력</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

        <div className="flex min-w-0 items-center gap-2">
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
              className="rounded-sm border border-emerald-500 bg-white px-2 py-0.5 text-sm font-semibold text-zinc-900 focus:outline-none dark:bg-zinc-900 dark:text-white"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTempTitle(title);
                setIsEditingTitle(true);
              }}
              className="flex max-w-xs cursor-pointer items-center gap-1.5 truncate text-left text-sm font-bold text-zinc-900 transition-colors hover:text-emerald-600 sm:max-w-md dark:text-white dark:hover:text-emerald-400"
              title="클릭하여 제목 수정"
            >
              <span className="truncate">{title}</span>
              <svg
                className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
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

          <SaveStatusIndicator />
        </div>

        {(onUndo || onRedo) && (
          <div className="hidden items-center gap-0.5 border-l border-zinc-200 pl-2 sm:flex dark:border-zinc-800">
            <button
              type="button"
              data-testid="header-undo-btn"
              disabled={!canUndo}
              onClick={onUndo}
              className="cursor-pointer rounded-sm p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-25 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
              title="실행 취소 (Ctrl/⌘+Z)"
            >
              <svg
                className="size-3.5"
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
              className="cursor-pointer rounded-sm p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-25 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
              title="다시 실행 (Ctrl/⌘+Shift+Z)"
            >
              <svg
                className="size-3.5"
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

      <div className="flex shrink-0 items-center gap-2">
        <div ref={shortcutsRef} className="relative">
          <button
            type="button"
            data-testid="header-shortcuts-btn"
            aria-expanded={showShortcuts}
            onClick={() => setShowShortcuts((prev) => !prev)}
            className="flex cursor-pointer items-center gap-1 rounded-lg p-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            title="편집·송출 단축키 안내"
          >
            <svg
              className="size-4"
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
            <div
              data-testid="header-shortcuts-popover"
              className="absolute top-10 right-0 z-50 max-h-[75vh] w-96 space-y-2 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-2xl"
            >
              <ShortcutTable
                heading="편집 단축키"
                rows={EDITOR_SHORTCUT_GUIDE}
              />
              <ShortcutTable
                heading="발표 송출 단축키"
                rows={PRESENTATION_SHORTCUT_GUIDE}
              />
              <div className="space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                <div className="font-semibold text-zinc-700 dark:text-zinc-300">
                  번호 이동 규칙
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-zinc-500 dark:text-zinc-400">
                  {NUMBER_JUMP_RULES.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <ThemeMenuButton variant="compact" direction="down" align="right" />

        <button
          type="button"
          data-testid="header-present-btn"
          disabled={totalSongs === 0}
          onClick={onPresent}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 dark:shadow-md dark:shadow-emerald-950/50 dark:hover:shadow-emerald-900/60"
        >
          <svg className="size-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span>슬라이드쇼 발표</span>
        </button>
      </div>
    </header>
  );
}
