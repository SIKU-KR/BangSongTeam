import React from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { ButtonGroup } from "#components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import { IconButton } from "#components/common/IconButton";
import type { DriveTypeFilter } from "../../routes/appShellContext";
import { ActionMenuItems, type MenuAction } from "./ActionMenu";
import { DRIVE_COPY } from "#copy/drive";

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
  const active = value !== "all";

  const actions: MenuAction[] = (["folder", "file"] as const).map((option) => ({
    key: option,
    label: DRIVE_COPY.kind[option],
    icon: value === option ? CheckIcon : undefined,
    testId: `type-option-${option}`,
    onSelect: () => onChange(option),
  }));

  return (
    <ButtonGroup>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="drive-type-dropdown"
          render={<Button variant={active ? "secondary" : "outline"} />}
        >
          {active && <CheckIcon />}
          {active ? DRIVE_COPY.kind[value] : DRIVE_COPY.type}
          {!active && <ChevronDownIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-testid="drive-type-menu"
          aria-label={DRIVE_COPY.type}
          className="min-w-60"
        >
          <ActionMenuItems actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
      {active && (
        <IconButton
          label={DRIVE_COPY.clearType}
          variant="secondary"
          data-testid="drive-type-clear"
          onClick={() => onChange("all")}
        >
          <XIcon />
        </IconButton>
      )}
    </ButtonGroup>
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
}: {
  count: number;
  actions: MenuAction[];
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div
      data-testid="selection-bar"
      className="flex h-10 w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted pr-2 pl-1"
    >
      <IconButton
        label={DRIVE_COPY.clearSelection}
        data-testid="selection-clear"
        onClick={onClear}
      >
        <XIcon />
      </IconButton>
      <span className="px-2 text-sm font-medium whitespace-nowrap">
        {DRIVE_COPY.selected(count)}
      </span>
      {actions
        .filter((action) => action.key !== "open")
        .map((action) => (
          <IconButton
            key={action.key}
            label={action.label}
            data-testid={action.testId ? `bar-${action.testId}` : undefined}
            disabled={action.disabled}
            className={cn(action.danger && "text-destructive")}
            onClick={action.onSelect}
          >
            {action.icon && <action.icon />}
          </IconButton>
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="selection-more"
          aria-label={DRIVE_COPY.moreActions}
          render={<Button variant="ghost" size="icon" />}
        >
          <EllipsisVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-testid="drive-menu"
          aria-label={DRIVE_COPY.actions}
          className="min-w-60"
        >
          <ActionMenuItems actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export interface DriveToolbarProps {
  mode: "drive" | "trash";
  selectionCount: number;
  selectionActions: MenuAction[];
  onClearSelection: () => void;
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
        />
      ) : mode === "trash" ? (
        <div className="flex h-10 w-full items-center justify-between gap-3 rounded-lg bg-muted pr-1 pl-4">
          <p
            className="truncate text-sm text-muted-foreground"
            data-testid="drive-summary"
          >
            {DRIVE_COPY.trashSummary}
          </p>
          <Button
            variant="ghost"
            data-testid="empty-trash-btn"
            disabled={!canEmptyTrash}
            onClick={onEmptyTrash}
          >
            {DRIVE_COPY.emptyTrash}
          </Button>
        </div>
      ) : (
        <div className="flex w-full items-center justify-between gap-3">
          <TypeFilterChip value={typeFilter} onChange={onTypeFilterChange} />
          <p
            className="truncate text-xs text-muted-foreground"
            data-testid="drive-summary"
          >
            {summary}
          </p>
        </div>
      )}
    </div>
  );
}
