import React, { useRef, useState } from "react";
import type { DriveTypeFilter } from "../../routes/appShellContext";
import { PopoverMenu, type MenuAction } from "./PopoverMenu";
import { Icon } from "./icons";

const TYPE_LABELS: Record<Exclude<DriveTypeFilter, "all">, string> = {
  folder: "폴더",
  file: "프레젠테이션",
};

/**
 * 구글 드라이브식 유형 칩. 값을 고르면 칩이 채워지고 ✕로 전체로 돌아간다.
 */
function TypeFilterChip({
  value,
  onChange,
}: {
  value: DriveTypeFilter;
  onChange: (value: DriveTypeFilter) => void;
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = value !== "all";

  const actions: MenuAction[] = (["folder", "file"] as const).map((option) => ({
    key: option,
    label: TYPE_LABELS[option],
    icon: value === option ? "check" : undefined,
    testId: `type-option-${option}`,
    onSelect: () => onChange(option),
  }));

  return (
    <div
      className={`flex h-8 items-center rounded-lg border text-sm font-medium transition-colors ${
        active
          ? "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
          : "border-zinc-400/70 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
      }`}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="drive-type-dropdown"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
        className={`flex h-full cursor-pointer items-center gap-1.5 rounded-lg ${
          active
            ? "pr-1 pl-2"
            : "px-3 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
        }`}
      >
        {active && <Icon name="check" className="size-4" />}
        <span>{active ? TYPE_LABELS[value] : "유형"}</span>
        {!active && <Icon name="chevronDown" className="size-4" />}
      </button>
      {active && (
        <button
          type="button"
          data-testid="drive-type-clear"
          aria-label="유형 필터 지우기"
          title="유형 필터 지우기"
          onClick={() => onChange("all")}
          className="h-full cursor-pointer rounded-r-lg px-1.5 hover:bg-emerald-200/70 dark:hover:bg-emerald-800/60"
        >
          <Icon name="close" className="size-4" />
        </button>
      )}
      {anchor && (
        <PopoverMenu
          anchor={anchor}
          actions={actions}
          label="유형"
          testId="drive-type-menu"
          triggerRef={triggerRef}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

/**
 * 선택 막대. 항목을 고르면 칩 줄 자리에 대신 뜬다 (구글 드라이브와 같다).
 * 열기를 뺀 작업은 아이콘으로, 전체 메뉴는 ⋮로 연다.
 */
function SelectionBar({
  count,
  actions,
  onClear,
  onMore,
}: {
  count: number;
  actions: MenuAction[];
  onClear: () => void;
  onMore: (anchor: { x: number; y: number }) => void;
}): React.JSX.Element {
  return (
    <div
      data-testid="selection-bar"
      className="flex h-10 w-full items-center gap-0.5 overflow-x-auto rounded-full bg-zinc-200/70 pr-2 pl-1 dark:bg-zinc-800/80"
    >
      <button
        type="button"
        aria-label="선택 해제"
        title="선택 해제"
        data-testid="selection-clear"
        onClick={onClear}
        className="cursor-pointer rounded-full p-2 text-zinc-700 hover:bg-zinc-900/10 dark:text-zinc-300 dark:hover:bg-white/10"
      >
        <Icon name="close" className="size-5" />
      </button>
      <span className="px-2 text-sm font-medium whitespace-nowrap text-zinc-900 dark:text-zinc-100">
        {count}개 선택됨
      </span>
      {actions
        .filter((action) => action.key !== "open")
        .map((action) => (
          <button
            key={action.key}
            type="button"
            data-testid={action.testId ? `bar-${action.testId}` : undefined}
            aria-label={action.label}
            title={action.label}
            disabled={action.disabled}
            onClick={action.onSelect}
            className={`cursor-pointer rounded-full p-2 disabled:cursor-not-allowed disabled:opacity-40 ${
              action.danger
                ? "text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                : "text-zinc-700 hover:bg-zinc-900/10 dark:text-zinc-300 dark:hover:bg-white/10"
            }`}
          >
            {action.icon && <Icon name={action.icon} className="size-5" />}
          </button>
        ))}
      <button
        type="button"
        aria-label="작업 더보기"
        title="작업 더보기"
        data-testid="selection-more"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onMore({ x: rect.left, y: rect.bottom + 4 });
        }}
        className="cursor-pointer rounded-full p-2 text-zinc-700 hover:bg-zinc-900/10 dark:text-zinc-300 dark:hover:bg-white/10"
      >
        <Icon name="dots" className="size-5" />
      </button>
    </div>
  );
}

export interface DriveToolbarProps {
  mode: "drive" | "trash";
  selectionCount: number;
  selectionActions: MenuAction[];
  onClearSelection: () => void;
  onSelectionMore: (anchor: { x: number; y: number }) => void;
  summary: string;
  typeFilter: DriveTypeFilter;
  onTypeFilterChange: (value: DriveTypeFilter) => void;
  canEmptyTrash: boolean;
  onEmptyTrash: () => void;
}

/**
 * 목록 위 한 줄. 평소에는 유형 칩(휴지통은 안내 배너)을, 선택 중에는 선택 막대를
 * 같은 자리에 보여 레이아웃이 밀리지 않는다.
 */
export function DriveToolbar({
  mode,
  selectionCount,
  selectionActions,
  onClearSelection,
  onSelectionMore,
  summary,
  typeFilter,
  onTypeFilterChange,
  canEmptyTrash,
  onEmptyTrash,
}: DriveToolbarProps): React.JSX.Element {
  return (
    <div
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="flex h-14 shrink-0 items-center px-4 sm:px-6"
    >
      {selectionCount > 0 ? (
        <SelectionBar
          count={selectionCount}
          actions={selectionActions}
          onClear={onClearSelection}
          onMore={onSelectionMore}
        />
      ) : mode === "trash" ? (
        <div className="flex h-10 w-full items-center justify-between gap-3 rounded-lg bg-zinc-200/60 pr-1 pl-4 dark:bg-zinc-800/70">
          <p
            className="truncate text-sm text-zinc-700 dark:text-zinc-300"
            data-testid="drive-summary"
          >
            휴지통의 항목은 영구 삭제하기 전까지 언제든 복원할 수 있습니다.
          </p>
          <button
            type="button"
            data-testid="empty-trash-btn"
            disabled={!canEmptyTrash}
            onClick={onEmptyTrash}
            className="shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
          >
            휴지통 비우기
          </button>
        </div>
      ) : (
        <div className="flex w-full items-center justify-between gap-3">
          <TypeFilterChip value={typeFilter} onChange={onTypeFilterChange} />
          <p
            className="truncate text-xs text-zinc-500"
            data-testid="drive-summary"
          >
            {summary}
          </p>
        </div>
      )}
    </div>
  );
}
