import React from "react";
import { useDriveDraggable, useDriveDroppable } from "./driveContext";
import { buildSubtitle, formatDate, type DriveItem } from "./driveModel";
import { FolderGlyph, Icon } from "./icons";

export interface DriveItemHandlers {
  selected: boolean;
  interactive: boolean;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
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

const LIST_COLUMNS =
  "grid items-center gap-x-4 px-4 grid-cols-[minmax(0,1fr)_7.5rem_8.5rem] sm:grid-cols-[minmax(0,1fr)_3rem_7.5rem_8.5rem] md:grid-cols-[minmax(0,1fr)_3rem_6.5rem_7.5rem_8.5rem]";

function MoreButton({
  label,
  onMore,
}: {
  label: string;
  onMore: DriveItemHandlers["onMore"];
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="item-more-btn"
      aria-label={`${label} 더보기`}
      onClick={(event) => {
        event.stopPropagation();
        onMore(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className="p-1 -mr-1 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer shrink-0"
    >
      <Icon name="dots" className="w-4 h-4" />
    </button>
  );
}

function RowButton({
  testId,
  label,
  title,
  accent,
  onSelect,
}: {
  testId: string;
  label: string;
  title: string;
  accent?: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold cursor-pointer transition-colors ${
        accent
          ? "hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600"
          : "hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

/** 목록 머리글. 열 폭은 `DriveListRow`와 같은 격자를 쓴다. */
export function DriveListHeader({
  dateLabel,
}: {
  dateLabel: string;
}): React.JSX.Element {
  return (
    <div
      className={`${LIST_COLUMNS} py-3 bg-zinc-50 dark:bg-zinc-900/90 text-[11px] text-zinc-600 dark:text-zinc-500 font-semibold border-b border-zinc-200 dark:border-zinc-800 uppercase tracking-wider`}
    >
      <span>이름</span>
      <span className="hidden sm:block">소유자</span>
      <span className="hidden md:block">{dateLabel}</span>
      <span>구성</span>
      <span className="text-right">작업</span>
    </div>
  );
}

/**
 * 드라이브 목록의 한 줄 (폴더 또는 프레젠테이션).
 *
 * `date`는 날짜 칸에 보일 ISO 시각이다. 드라이브는 수정 시각, 휴지통은 버린 시각을
 * 넘긴다.
 */
export function DriveListRow({
  item,
  date,
  handlers,
}: {
  item: DriveItem;
  date: string;
  handlers: DriveItemHandlers;
}): React.JSX.Element {
  const dnd = useItemDnd(item, handlers.interactive);
  const isFolder = item.kind === "folder";
  const stateClass = dnd.isDropTarget
    ? "bg-emerald-50 dark:bg-emerald-950/40 outline outline-2 -outline-offset-2 outline-emerald-500"
    : handlers.selected
      ? "bg-emerald-50/80 dark:bg-emerald-950/30"
      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50";

  return (
    <div
      ref={dnd.ref}
      {...dnd.listeners}
      role="option"
      aria-selected={handlers.selected}
      aria-label={`${isFolder ? "폴더" : "프레젠테이션"} ${item.name}`}
      tabIndex={0}
      data-testid={isFolder ? "folder-row" : "presentation-row"}
      data-item-key={item.key}
      onClick={handlers.onClick}
      onDoubleClick={handlers.onDoubleClick}
      onContextMenu={handlers.onContextMenu}
      className={`${LIST_COLUMNS} py-2.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer select-none transition-colors outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800 ${stateClass} ${
        dnd.isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
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
        <div className="min-w-0">
          <span
            className="font-semibold text-zinc-900 dark:text-white truncate block"
            title={item.name}
          >
            {item.name}
          </span>
          <span className="text-[11px] text-zinc-500 truncate block">
            {item.location ??
              (isFolder ? "폴더" : buildSubtitle(item.presentation))}
          </span>
        </div>
      </div>
      <span className="hidden sm:block text-zinc-500 dark:text-zinc-400">
        나
      </span>
      <span className="hidden md:block text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
        {formatDate(date)}
      </span>
      <span className="min-w-0">
        <span className="inline-block max-w-full truncate align-middle px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
          {isFolder
            ? `항목 ${item.childCount}개`
            : `${item.songCount}곡 · ${item.slideCount}슬라이드`}
        </span>
      </span>
      <div className="flex items-center justify-end gap-1.5">
        {handlers.onPresent && (
          <RowButton
            testId="row-present-btn"
            label="발표"
            title="전체화면 송출"
            accent
            onSelect={handlers.onPresent}
          />
        )}
        {handlers.onEdit && (
          <RowButton
            testId="row-edit-btn"
            label="편집"
            title="편집기 열기"
            onSelect={handlers.onEdit}
          />
        )}
        <MoreButton label={item.name} onMore={handlers.onMore} />
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
    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50";

  return (
    <div
      ref={setNodeRef}
      role="button"
      aria-label="휴지통 (고정 폴더)"
      tabIndex={0}
      data-testid="drive-trash-folder"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`${LIST_COLUMNS} py-2.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer select-none transition-colors outline-none border-b last:border-b-0 border-zinc-200 dark:border-zinc-800/60 focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800 ${stateClass}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          data-testid="row-icon-trash"
          className="flex shrink-0 text-rose-500 dark:text-rose-400"
        >
          <Icon name="trash" className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <span className="font-semibold text-zinc-900 dark:text-white truncate block">
            휴지통
          </span>
          <span className="text-[11px] text-zinc-500 truncate block">
            삭제한 항목은 영구 삭제 전까지 복원할 수 있습니다
          </span>
        </div>
      </div>
      <span className="hidden sm:block text-zinc-500 dark:text-zinc-400">
        나
      </span>
      <span className="hidden md:block text-zinc-400 dark:text-zinc-500">
        -
      </span>
      <span className="min-w-0">
        <span
          data-testid="trash-folder-count"
          className="inline-block max-w-full truncate align-middle px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
        >
          {`항목 ${count}개`}
        </span>
      </span>
      <div className="flex items-center justify-end gap-1.5">
        <RowButton
          testId="trash-folder-open-btn"
          label="열기"
          title="휴지통 열기"
          onSelect={onOpen}
        />
        <MoreButton
          label="휴지통"
          onMore={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu({ x: rect.right - 200, y: rect.bottom + 4 });
          }}
        />
      </div>
    </div>
  );
}
