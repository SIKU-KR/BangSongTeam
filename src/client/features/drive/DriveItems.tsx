import React, { useState } from "react";
import {
  ArrowUpIcon,
  EllipsisVerticalIcon,
  FolderIcon,
  PencilIcon,
  PlayIcon,
  PresentationIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import { IconButton } from "#components/common/IconButton";
import type { SortKey, SortOrder } from "../../routes/appShellContext";
import { useDriveDraggable, useDriveDroppable } from "./driveContext";
import { formatDate, type DriveItem } from "./driveModel";
import { ActionMenuItems, type MenuAction } from "./ActionMenu";

export interface DriveItemHandlers {
  selected: boolean;
  /** 로빙 tabindex: 목록에서 이 행만 Tab으로 들어올 수 있다 */
  tabStop: boolean;
  interactive: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onFocus: () => void;
  /** ⋮ 메뉴를 열 때 부른다. 선택되지 않은 행이면 그 행만 선택한다 */
  menuActions: () => MenuAction[];
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

/** 머리글과 행이 같은 열 폭을 쓴다. 좁은 화면에서는 위치·날짜 열을 숨긴다 */
const COLUMNS = {
  row: "flex items-center gap-x-4 pr-2 pl-4",
  name: "flex min-w-0 flex-1 items-center gap-4",
  location: "hidden w-40 shrink-0 truncate sm:block md:w-48",
  date: "hidden w-30 shrink-0 whitespace-nowrap md:block",
  actions: "flex w-26 shrink-0 items-center justify-end",
} as const;

const HOVER_REVEAL =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-aria-selected:opacity-100 focus-visible:opacity-100";

const ROW_CLASS =
  "group h-12 cursor-default border-b text-sm text-muted-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/** 행 안의 조작이 행 선택·더블클릭 열기로 번지지 않게 막는다 */
const STOP_ROW_EVENTS = {
  onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
  onContextMenu: (event: React.MouseEvent) => event.stopPropagation(),
};

/** 행의 ⋮ 메뉴. 항목은 열 때 계산한다 (선택을 바꾸는 부수 효과가 있어서) */
function RowMenu({
  label,
  getActions,
}: {
  label: string;
  getActions: () => MenuAction[];
}): React.JSX.Element {
  const [actions, setActions] = useState<MenuAction[]>([]);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setActions(getActions());
      }}
    >
      <DropdownMenuTrigger
        data-testid="item-more-btn"
        aria-label={label}
        tabIndex={-1}
        {...STOP_ROW_EVENTS}
        render={<Button variant="ghost" size="icon" />}
      >
        <EllipsisVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid="drive-menu"
        align="end"
        className="min-w-60"
        {...STOP_ROW_EVENTS}
      >
        <ActionMenuItems actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowIconButton({
  testId,
  icon: Icon,
  label,
  onSelect,
}: {
  testId: string;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <IconButton
      label={label}
      tabIndex={-1}
      data-testid={testId}
      className={HOVER_REVEAL}
      {...STOP_ROW_EVENTS}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <Icon />
    </IconButton>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
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
      <Button
        variant="ghost"
        size="sm"
        data-testid={`sort-header-${sortKey}`}
        className={cn("-ml-2.5", active && "text-foreground")}
        onClick={(event) => {
          event.stopPropagation();
          onSort(sortKey);
        }}
      >
        {label}
        {active && (
          <ArrowUpIcon
            className={cn(
              "transition-transform",
              sort.direction === "desc" && "rotate-180",
            )}
          />
        )}
      </Button>
    </span>
  );
}

/**
 * 목록 머리글. 열 폭은 `DriveListRow`와 같은 격자를 쓴다.
 * `onSort`를 주면 이름·날짜 머리글을 눌러 정렬한다 (구글 드라이브와 같다).
 * `locationLabel`을 주면 위치 열을 보인다 (검색 결과·휴지통).
 */
export function DriveListHeader({
  locationLabel,
  dateLabel,
  sort,
  onSort,
}: {
  locationLabel?: string;
  dateLabel: string;
  sort?: SortOrder;
  onSort?: (key: SortKey) => void;
}): React.JSX.Element {
  return (
    <div
      role="row"
      onClick={(event) => event.stopPropagation()}
      className={cn(
        COLUMNS.row,
        "sticky top-0 z-10 h-12 border-b bg-background text-sm font-medium text-muted-foreground",
      )}
    >
      <SortHeader
        label="이름"
        sortKey="name"
        sort={sort}
        onSort={onSort}
        className={COLUMNS.name}
      />
      {locationLabel && (
        <span role="columnheader" className={COLUMNS.location}>
          {locationLabel}
        </span>
      )}
      <SortHeader
        label={dateLabel}
        sortKey="updated"
        sort={sort}
        onSort={onSort}
        className={COLUMNS.date}
      />
      <span className={COLUMNS.actions}>
        <span className="sr-only">작업</span>
      </span>
    </div>
  );
}

/**
 * 드라이브 목록의 한 줄 (폴더 또는 프레젠테이션).
 *
 * `date`는 날짜 칸에 보일 ISO 시각이다. 드라이브는 수정 시각, 휴지통은 버린 시각을
 * 넘긴다. `showLocation`이면 이름 옆에 항목의 위치를 보인다.
 * 발표·편집 버튼은 마우스를 올리거나 선택·포커스했을 때만 보인다.
 */
export function DriveListRow({
  item,
  date,
  showLocation,
  handlers,
}: {
  item: DriveItem;
  date: string;
  showLocation: boolean;
  handlers: DriveItemHandlers;
}): React.JSX.Element {
  const dnd = useItemDnd(item, handlers.interactive);
  const isFolder = item.kind === "folder";
  const stateClass = dnd.isDropTarget
    ? "bg-primary/5 outline-2 -outline-offset-2 outline-primary"
    : handlers.selected
      ? "bg-primary/10"
      : "hover:bg-muted";

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
      onFocus={handlers.onFocus}
      className={cn(
        COLUMNS.row,
        ROW_CLASS,
        stateClass,
        dnd.isDragging && "opacity-40",
      )}
    >
      <div className={COLUMNS.name}>
        {isFolder ? (
          <span
            data-testid="row-icon-folder"
            className="flex shrink-0 text-muted-foreground"
          >
            <FolderIcon className="size-5 fill-current" />
          </span>
        ) : (
          <span
            data-testid="row-icon-presentation"
            className="flex shrink-0 text-foreground"
          >
            <PresentationIcon className="size-5" />
          </span>
        )}
        <span className="truncate font-medium text-foreground">
          {item.name}
        </span>
      </div>
      {showLocation && (
        <span className={COLUMNS.location}>{item.location ?? "-"}</span>
      )}
      <span className={COLUMNS.date}>{formatDate(date)}</span>
      <div className={COLUMNS.actions}>
        {handlers.onPresent && (
          <RowIconButton
            testId="row-present-btn"
            icon={PlayIcon}
            label="발표 (전체화면 송출)"
            onSelect={handlers.onPresent}
          />
        )}
        {handlers.onEdit && (
          <RowIconButton
            testId="row-edit-btn"
            icon={PencilIcon}
            label="편집기에서 열기"
            onSelect={handlers.onEdit}
          />
        )}
        <RowMenu
          label={`${item.name} 더보기`}
          getActions={handlers.menuActions}
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
  onOpen,
  menuActions,
}: {
  onOpen: () => void;
  menuActions: () => MenuAction[];
}): React.JSX.Element {
  const { setNodeRef, isDropTarget } = useDriveDroppable("item:trash-folder", {
    kind: "trash",
  });
  const stateClass = isDropTarget
    ? "bg-destructive/10 outline-2 -outline-offset-2 outline-destructive"
    : "hover:bg-muted";

  return (
    <div
      ref={setNodeRef}
      role="button"
      aria-label="휴지통 (고정 폴더)"
      tabIndex={0}
      data-testid="drive-trash-folder"
      data-trash-folder
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      className={cn(COLUMNS.row, ROW_CLASS, stateClass)}
    >
      <div className={COLUMNS.name}>
        <span
          data-testid="row-icon-trash"
          className="flex shrink-0 text-destructive"
        >
          <Trash2Icon className="size-5" />
        </span>
        <span className="truncate font-medium text-foreground">휴지통</span>
      </div>
      <span className={COLUMNS.date}>-</span>
      <div className={COLUMNS.actions}>
        <RowIconButton
          testId="trash-folder-open-btn"
          icon={SquareArrowOutUpRightIcon}
          label="휴지통 열기"
          onSelect={onOpen}
        />
        <RowMenu label="휴지통 더보기" getActions={menuActions} />
      </div>
    </div>
  );
}
