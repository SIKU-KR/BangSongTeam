import React, { useCallback, useRef, useState } from "react";
import { FolderIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { Button } from "#components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#components/ui/context-menu";
import { useNavigate } from "react-router-dom";
import { useAppShell } from "../../routes/appShellContext";
import { useDrive } from "./driveContext";
import { TRASH_PATH } from "./drivePaths";
import { nextSortOrder, trashedAtOf, type DriveItem } from "./driveModel";
import {
  DriveListHeader,
  DriveListRow,
  TrashFolderRow,
  type DriveItemHandlers,
} from "./DriveItems";
import { DriveToolbar } from "./DriveToolbar";
import {
  ActionMenuItems,
  type MenuAction,
} from "#components/common/ActionMenu";
import { useNewItemActions } from "./NewMenu";
import {
  mergeKeys,
  rangeKeys,
  toggleKey,
  visibleKey,
} from "#lib/selection/selectionModel";
import { useDriveItemActions } from "./useDriveItemActions";
import { useDriveKeyboard } from "./useDriveKeyboard";
import { useDriveListing } from "./useDriveListing";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { DRIVE_COPY } from "#copy/drive";
import { COMMON_COPY } from "#copy/common";

export interface DriveBrowserProps {
  mode: "drive" | "trash";
  folderId?: string | null;
}

/**
 * 드라이브 본문 (폴더 내용 / 검색 결과 / 휴지통). 조작은 구글 드라이브를 따른다.
 *
 * 폴더와 파일을 한 목록에 섞어 보여 준다. 섹션을 나누지 않는다.
 * - 누르기: 선택 (선택된 묶음을 누르면 끌 수 있게 유지하고, 떼면 그 항목만 남긴다)
 * - Ctrl/⌘+클릭: 추가·해제 · Shift+클릭: 범위 · Ctrl/⌘+Shift+클릭: 범위 추가 · 더블클릭: 열기
 * - 빈 곳에서 끌기: 드래그 선택 · 우클릭·⋮: 메뉴 · 머리글: 정렬
 * - 끌어서 폴더·경로·고정된 휴지통 폴더에 놓기
 * - 키보드는 `useDriveKeyboard`
 */
export function DriveBrowser({
  mode,
  folderId = null,
}: DriveBrowserProps): React.JSX.Element {
  const navigate = useNavigate();
  const { searchQuery } = useAppShell();
  const drive = useDrive();
  const { sortOrder, typeFilter } = drive;
  const newActions = useNewItemActions();
  const [contextActions, setContextActions] = useState<MenuAction[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const isTrash = mode === "trash";
  const {
    query,
    items,
    keys,
    isFiltered,
    showTrashFolder,
    trashCount,
    summary,
  } = useDriveListing({
    isTrash,
    folderId,
    searchQuery,
    sortOrder,
    typeFilter,
  });
  const selectedItems = items.filter((item) => drive.selection.has(item.key));
  const tabStopKey = visibleKey(keys, drive.focusKey) ?? keys[0] ?? null;

  const { present, open, trashFolderActions, actionsFor } = useDriveItemActions(
    { isTrash, trashCount },
  );

  const focusRow = useCallback((key: string): void => {
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-item-key="${key}"]`,
    );
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const targetsFor = (item: DriveItem): DriveItem[] => {
    if (drive.selection.has(item.key)) return selectedItems;
    drive.setSelection([item.key], item.key);
    return [item];
  };

  const handlersFor = (item: DriveItem): DriveItemHandlers => ({
    selected: drive.selection.has(item.key),
    tabStop: item.key === tabStopKey,
    interactive: !isTrash,
    onMouseDown: (event) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (!drive.selection.has(item.key)) {
        drive.setSelection([item.key], item.key);
      }
    },
    onClick: (event) => {
      event.stopPropagation();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey) {
        drive.setSelection(
          mergeKeys(
            [...drive.selection],
            rangeKeys(keys, drive.anchorKey, item.key),
          ),
        );
        drive.setFocusKey(item.key);
      } else if (mod) {
        drive.setSelection(toggleKey(drive.selection, item.key), item.key);
      } else if (event.shiftKey) {
        drive.setSelection(rangeKeys(keys, drive.anchorKey, item.key));
        drive.setFocusKey(item.key);
      } else {
        drive.setSelection([item.key], item.key);
      }
    },
    onDoubleClick: () => open(item),
    onFocus: () => {
      if (drive.focusKey !== item.key) drive.setFocusKey(item.key);
    },
    menuActions: () => actionsFor(targetsFor(item)),
    onPresent:
      !isTrash && item.kind === "file" ? () => present(item.id) : undefined,
    onEdit:
      !isTrash && item.kind === "file"
        ? () => navigate(`/editor/${item.id}`)
        : undefined,
  });

  useDriveKeyboard({
    drive,
    items,
    isTrash,
    enabled: !drive.dialogOpen && !drive.activeDrag,
    open,
    focusRow,
  });

  const marquee = useMarqueeSelection({
    containerRef,
    enabled: !drive.activeDrag,
    selection: drive.selection,
    onSelect: (next) => drive.setSelection(next, next[0] ?? null),
  });

  return (
    <div
      data-testid={isTrash ? "trash-view" : "drive-view"}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DriveToolbar
        mode={mode}
        selectionCount={selectedItems.length}
        selectionActions={actionsFor(selectedItems)}
        onClearSelection={() => drive.clearSelection()}
        summary={summary}
        typeFilter={typeFilter}
        onTypeFilterChange={drive.setTypeFilter}
        canEmptyTrash={trashCount > 0}
        onEmptyTrash={() => drive.requestEmptyTrash()}
      />

      <ContextMenu>
        <ContextMenuTrigger
          ref={containerRef}
          data-testid="drive-scroll-area"
          className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-16 sm:px-6"
          onMouseDown={marquee.onMouseDown}
          onClick={(event) => {
            if (marquee.consumeClick()) return;
            if (
              (event.target as HTMLElement).closest("[data-drive-list-header]")
            )
              return;
            drive.clearSelection();
          }}
          onContextMenu={(event) => {
            const target = event.target as HTMLElement;
            const rowKey = target
              .closest<HTMLElement>("[data-item-key]")
              ?.getAttribute("data-item-key");
            const item = items.find((candidate) => candidate.key === rowKey);
            if (item) {
              setContextActions(actionsFor(targetsFor(item)));
            } else if (target.closest("[data-trash-folder]")) {
              drive.clearSelection();
              setContextActions(trashFolderActions);
            } else if (isTrash || query) {
              event.preventBaseUIHandler();
            } else {
              drive.clearSelection();
              setContextActions(newActions);
            }
          }}
        >
          {(items.length > 0 || showTrashFolder) && (
            <>
              <DriveListHeader
                locationLabel={
                  isTrash
                    ? DRIVE_COPY.originalLocation
                    : query
                      ? DRIVE_COPY.location
                      : undefined
                }
                dateLabel={
                  isTrash ? DRIVE_COPY.deletedAt : DRIVE_COPY.updatedAt
                }
                sort={isTrash ? undefined : sortOrder}
                onSort={
                  isTrash
                    ? undefined
                    : (key) => drive.setSortOrder(nextSortOrder(sortOrder, key))
                }
              />
              {showTrashFolder && (
                <TrashFolderRow
                  onOpen={() => navigate(TRASH_PATH)}
                  menuActions={() => {
                    drive.clearSelection();
                    return trashFolderActions;
                  }}
                />
              )}
              {items.length > 0 && (
                <div
                  role="listbox"
                  aria-multiselectable="true"
                  aria-label={
                    isTrash ? COMMON_COPY.trash : DRIVE_COPY.itemsList
                  }
                >
                  {items.map((item) => (
                    <DriveListRow
                      key={item.key}
                      item={item}
                      showLocation={isTrash || Boolean(query)}
                      date={
                        isTrash
                          ? (trashedAtOf(item) ?? item.updatedAt)
                          : item.updatedAt
                      }
                      handlers={handlersFor(item)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {items.length === 0 && (
            <EmptyState mode={mode} query={query} filtered={isFiltered} />
          )}
        </ContextMenuTrigger>
        <ContextMenuContent data-testid="drive-menu" className="min-w-60">
          <ActionMenuItems kind="context" actions={contextActions} />
        </ContextMenuContent>
      </ContextMenu>

      {marquee.box && (
        <div
          data-testid="drive-marquee"
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-sm border border-primary bg-primary/10"
          style={{
            left: marquee.box.left,
            top: marquee.box.top,
            width: marquee.box.right - marquee.box.left,
            height: marquee.box.bottom - marquee.box.top,
          }}
        />
      )}
    </div>
  );
}

function EmptyState({
  mode,
  query,
  filtered,
}: {
  mode: "drive" | "trash";
  query: string;
  filtered: boolean;
}): React.JSX.Element {
  const drive = useDrive();
  const newActions = useNewItemActions();

  let icon: React.ReactNode = <FolderIcon />;
  let title: string;
  let hint: string;
  if (query) {
    icon = <SearchIcon />;
    title = DRIVE_COPY.empty.searchTitle(query);
    hint = DRIVE_COPY.empty.searchHint;
  } else if (filtered) {
    title = DRIVE_COPY.empty.filteredTitle;
    hint = DRIVE_COPY.empty.filteredHint;
  } else if (mode === "trash") {
    icon = <Trash2Icon />;
    title = DRIVE_COPY.empty.trashTitle;
    hint = DRIVE_COPY.empty.trashHint;
  } else if (drive.currentFolderId) {
    title = DRIVE_COPY.empty.folderTitle;
    hint = DRIVE_COPY.empty.folderHint;
  } else {
    title = DRIVE_COPY.empty.rootTitle;
    hint = DRIVE_COPY.empty.rootHint;
  }

  return (
    <Empty data-testid="drive-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{hint}</EmptyDescription>
      </EmptyHeader>
      {mode === "drive" && !query && !filtered && (
        <EmptyContent className="flex-row justify-center">
          {newActions.map((action) => (
            <Button
              key={action.key}
              variant={
                action.key === "new-presentation" ? "default" : "outline"
              }
              data-testid={`empty-${action.key}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                action.onSelect();
              }}
            >
              {action.icon && <action.icon />}
              {action.label}
            </Button>
          ))}
        </EmptyContent>
      )}
    </Empty>
  );
}
