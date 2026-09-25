import React from "react";
import type { SortKey, SortOrder } from "../../routes/appShellContext";
import { useDriveDraggable, useDriveDroppable } from "./driveContext";
import { buildSubtitle, formatDate, type DriveItem } from "./driveModel";
import { FolderGlyph, Icon, type IconName } from "./icons";

/** 둘째 열이 소유자(폴더 보기)인지 위치(검색 결과·휴지통)인지 */
export type DriveColumnVariant = "owner" | "location";

export interface DriveItemHandlers {
  selected: boolean;
  /** 로빙 tabindex: 목록에서 이 행만 Tab으로 들어올 수 있다 */
  tabStop: boolean;
  interactive: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onFocus: () => void;
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPresent?: () => void;
  onEdit?: () => void;
}

function useItemDnd(
  item: DriveItem,
  interactive: boolean,
): {
  ref: (node: HTMLElement | null) => void;
  listeners: ReturnType<typeof useDriveDraggable>["listeners"];
  isDragging: boolean;
  isDropTarget: boolean;
} {
  const drag = useDriveDraggable(item.key, !interactive);
  const drop = useDriveDroppable(
    `item:${item.key}`,
    { kind: "folder", folderId: item.kind === "folder" ? item.id : null },
    !interactive || item.kind !== "folder",
  );
  return {
    ref: (node) => {
      drag.setNodeRef(node);
      drop.setNodeRef(node);
    },
    listeners: interactive ? drag.listeners : undefined,
    isDragging: drag.isDragging,
    isDropTarget: drop.isDropTarget,
  };
}

const LIST_COLUMNS: Record<DriveColumnVariant, string> = {
  owner:
    "grid items-center gap-x-4 pl-4 pr-2 grid-cols-[minmax(0,1fr)_8rem_6.5rem] sm:grid-cols-[minmax(0,1fr)_4rem_8rem_6.5rem] md:grid-cols-[minmax(0,1fr)_4rem_7.5rem_8rem_6.5rem]",
  location:
    "grid items-center gap-x-4 pl-4 pr-2 grid-cols-[minmax(0,1fr)_8rem_6.5rem] sm:grid-cols-[minmax(0,1fr)_10rem_8rem_6.5rem] md:grid-cols-[minmax(0,1fr)_12rem_7.5rem_8rem_6.5rem]",
};

const HOVER_REVEAL =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-aria-selected:opacity-100 focus-visible:opacity-100";

function RowIconButton({
  testId,
  icon,
  label,
  reveal = true,
  onSelect,
}: {
  testId: string;
  icon: IconName;
  label: string;
  reveal?: boolean;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-testid={testId}
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`p-2 rounded-full text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-900/10 dark:hover:bg-white/10 transition-opacity cursor-pointer shrink-0 ${
        reveal ? HOVER_REVEAL : ""
      }`}
    >
      <Icon
        name={icon}
        className={icon === "dots" ? "w-5 h-5" : "w-[18px] h-[18px]"}
      />
    </button>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort?: SortOrder;
  onSort?: (key: SortKey) => void;
  className?: string;
}): React.JSX.Element {
  const active = sort?.key === sortKey;
  const ariaSort = active
    ? sort.direction === "asc"
      ? "ascending"
      : "descending"
    : undefined;
  if (!onSort) {
    return (
      <span role="columnheader" className={className}>
        {label}
      </span>
    );
  }
  return (
    <span role="columnheader" aria-sort={ariaSort} className={className}>
      <button
        type="button"
        data-testid={`sort-header-${sortKey}`}
        onClick={(event) => {
          event.stopPropagation();
          onSort(sortKey);
        }}
        className={`-ml-2 px-2 py-1 rounded-full inline-flex items-center gap-1 cursor-pointer hover:bg-zinc-200/70 dark:hover:bg-zinc-800 ${
          active ? "text-zinc-900 dark:text-white" : ""
        }`}
      >
        <span>{label}</span>
        {active && (
          <svg
            className={`w-4 h-4 transition-transform ${
              sort.direction === "desc" ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19V5m-6 6l6-6 6 6"
            />
          </svg>
        )}
      </button>
    </span>
  );
}

/**
 * 목록 머리글. 열 폭은 `DriveListRow`와 같은 격자를 쓴다.
 * `onSort`를 주면 이름·날짜·구성 머리글을 눌러 정렬한다 (구글 드라이브와 같다).
 */
export function DriveListHeader({
  variant,
  secondLabel,
  dateLabel,
  sort,
  onSort,
}: {
  variant: DriveColumnVariant;
  secondLabel: string;
  dateLabel: string;
  sort?: SortOrder;
  onSort?: (key: SortKey) => void;
}): React.JSX.Element {
  return (
    <div
      role="row"
      onClick={(event) => event.stopPropagation()}
      className={`${LIST_COLUMNS[variant]} sticky top-0 z-10 h-12 bg-zinc-50 dark:bg-zinc-950 text-sm font-medium text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800`}
    >
      <SortHeader label="이름" sortKey="name" sort={sort} onSort={onSort} />
      <span role="columnheader" className="hidden sm:block truncate">
        {secondLabel}
      </span>
      <SortHeader
        label={dateLabel}
        sortKey="updated"
        sort={sort}
        onSort={onSort}
        className="hidden md:block"
      />
      <SortHeader label="구성" sortKey="slides" sort={sort} onSort={onSort} />
      <span className="sr-only">작업</span>
    </div>
  );
}

/**
 * 드라이브 목록의 한 줄 (폴더 또는 프레젠테이션).
 *
 * `date`는 날짜 칸에 보일 ISO 시각이다. 드라이브는 수정 시각, 휴지통은 버린 시각을
 * 넘긴다. `location` 열에서는 둘째 칸에 항목의 위치를 보인다.
 * 발표·편집 버튼은 마우스를 올리거나 선택·포커스했을 때만 보인다.
 */
export function DriveListRow({
  item,
  date,
  variant,
  handlers,
}: {
  item: DriveItem;
  date: string;
  variant: DriveColumnVariant;
  handlers: DriveItemHandlers;
}): React.JSX.Element {
  const dnd = useItemDnd(item, handlers.interactive);
  const isFolder = item.kind === "folder";
  const stateClass = dnd.isDropTarget
    ? "bg-emerald-50 dark:bg-emerald-950/40 outline outline-2 -outline-offset-2 outline-emerald-500"
    : handlers.selected
      ? "bg-emerald-100/80 dark:bg-emerald-900/40"
      : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60";
  const subtitle = isFolder ? null : buildSubtitle(item.presentation);

  return (
    <div
      ref={dnd.ref}
      {...dnd.listeners}
      role="option"
      aria-selected={handlers.selected}
      aria-label={`${isFolder ? "폴더" : "프레젠테이션"} ${item.name}`}
      tabIndex={handlers.tabStop ? 0 : -1}
      data-testid={isFolder ? "folder-row" : "presentation-row"}
      data-item-key={item.key}
      onMouseDown={handlers.onMouseDown}
      onClick={handlers.onClick}
      onDoubleClick={handlers.onDoubleClick}
      onContextMenu={handlers.onContextMenu}
      onFocus={handlers.onFocus}
      className={`group ${LIST_COLUMNS[variant]} h-12 text-sm text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 cursor-default select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 dark:focus-visible:ring-emerald-400 ${stateClass} ${
        dnd.isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-4 min-w-0">
        {isFolder ? (
          <span
            data-testid="row-icon-folder"
            className="flex shrink-0 text-emerald-500 dark:text-emerald-400"
          >
            <FolderGlyph />
          </span>
        ) : (
          <span
            data-testid="row-icon-presentation"
            className="flex shrink-0 text-indigo-500 dark:text-indigo-400"
          >
            <Icon name="slides" className="w-5 h-5" />
          </span>
        )}
        <div className="min-w-0 flex items-baseline gap-2">
          <span
            className="font-medium text-zinc-900 dark:text-white truncate"
            title={item.name}
          >
            {item.name}
          </span>
          {subtitle && (
            <span className="hidden lg:inline text-xs text-zinc-500 truncate">
              {subtitle}
            </span>
          )}
        </div>
      </div>
      <span
        className="hidden sm:block truncate"
        title={variant === "location" ? item.location : undefined}
      >
        {variant === "location" ? (item.location ?? "-") : "나"}
      </span>
      <span className="hidden md:block whitespace-nowrap">
        {formatDate(date)}
      </span>
      <span className="truncate">
        {isFolder
          ? `항목 ${item.childCount}개`
          : `${item.songCount}곡 · ${item.slideCount}슬라이드`}
      </span>
      <div className="flex items-center justify-end">
        {handlers.onPresent && (
          <RowIconButton
            testId="row-present-btn"
            icon="play"
            label="발표 (전체화면 송출)"
            onSelect={handlers.onPresent}
          />
        )}
        {handlers.onEdit && (
          <RowIconButton
            testId="row-edit-btn"
            icon="pencil"
            label="편집기에서 열기"
            onSelect={handlers.onEdit}
          />
        )}
        <RowIconButton
          testId="item-more-btn"
          icon="dots"
          label={`${item.name} 더보기`}
          reveal={false}
          onSelect={handlers.onMore}
        />
      </div>
    </div>
  );
}

/**
 * 내 드라이브 루트 맨 위에 고정된 휴지통 폴더.
 *
 * 실제 폴더가 아니라 휴지통 화면으로 가는 입구라서 선택·이름 바꾸기·이동·삭제가
 * 없다. 목록(listbox) 밖에 두어 전체 선택과 Delete 대상에서도 빠진다.
 * 항목을 끌어다 놓으면 휴지통으로 옮긴다.
 */
export function TrashFolderRow({
  count,
  onOpen,
  onMenu,
}: {
  count: number;
  onOpen: () => void;
  onMenu: (anchor: { x: number; y: number }) => void;
}): React.JSX.Element {
  const { setNodeRef, isDropTarget } = useDriveDroppable("item:trash-folder", {
    kind: "trash",
  });
  const stateClass = isDropTarget
    ? "bg-rose-50 dark:bg-rose-950/40 outline outline-2 -outline-offset-2 outline-rose-500"
    : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60";

  return (
    <div
      ref={setNodeRef}
      role="button"
      aria-label="휴지통 (고정 폴더)"
      tabIndex={0}
      data-testid="drive-trash-folder"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        } else if (
          event.key === "ContextMenu" ||
          (event.key === "F10" && event.shiftKey)
        ) {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu({ x: rect.left + 48, y: rect.bottom });
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`group ${LIST_COLUMNS.owner} h-12 text-sm text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 cursor-default select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 dark:focus-visible:ring-emerald-400 ${stateClass}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <span
          data-testid="row-icon-trash"
          className="flex shrink-0 text-rose-500 dark:text-rose-400"
        >
          <Icon name="trash" className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex items-baseline gap-2">
          <span className="font-medium text-zinc-900 dark:text-white truncate">
            휴지통
          </span>
          <span className="hidden lg:inline text-xs text-zinc-500 truncate">
            삭제한 항목은 영구 삭제 전까지 복원할 수 있습니다
          </span>
        </div>
      </div>
      <span className="hidden sm:block">나</span>
      <span className="hidden md:block">-</span>
      <span data-testid="trash-folder-count" className="truncate">
        {`항목 ${count}개`}
      </span>
      <div className="flex items-center justify-end">
        <RowIconButton
          testId="trash-folder-open-btn"
          icon="open"
          label="휴지통 열기"
          onSelect={onOpen}
        />
        <RowIconButton
          testId="item-more-btn"
          icon="dots"
          label="휴지통 더보기"
          reveal={false}
          onSelect={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu({ x: rect.right - 240, y: rect.bottom + 4 });
          }}
        />
      </div>
    </div>
  );
}
