import React, { useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePresentationList } from "../presentation";
import { useAppShell } from "../../routes/appShellContext";
import { useFolderIndex } from "./folderStore";
import { useDrive } from "./driveContext";
import { TRASH_PATH, openItem, startPresentation } from "./driveActions";
import {
  filterByType,
  listFolderContents,
  listTrash,
  nextSortOrder,
  searchDrive,
  trashedAtOf,
  type DriveItem,
  type DriveItemRef,
} from "./driveModel";
import {
  DriveListHeader,
  DriveListRow,
  TrashFolderRow,
  type DriveItemHandlers,
} from "./DriveItems";
import { DriveToolbar } from "./DriveToolbar";
import { PopoverMenu, type MenuAction } from "./PopoverMenu";
import { useNewItemActions } from "./NewMenu";
import { mergeKeys, rangeKeys, toggleKey } from "./selectionModel";
import { useDriveKeyboard } from "./useDriveKeyboard";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { FolderGlyph, Icon } from "./icons";

export interface DriveBrowserProps {
  mode: "drive" | "trash";
  folderId?: string | null;
}

interface MenuState {
  anchor: { x: number; y: number };
  actions: MenuAction[];
  fromKeyboard?: boolean;
}

function toRef(item: DriveItem): DriveItemRef {
  return { kind: item.kind, id: item.id };
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
  const { pathname } = useLocation();
  const {
    searchQuery,
    sortOrder,
    typeFilter,
    onSortOrderChange,
    onTypeFilterChange,
  } = useAppShell();
  const presentations = usePresentationList();
  const index = useFolderIndex();
  const drive = useDrive();
  const newActions = useNewItemActions();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const query = searchQuery.trim();
  const isTrash = mode === "trash";
  const items = useMemo(() => {
    if (isTrash) return listTrash(index, presentations, query);
    const listed = query
      ? searchDrive(index, presentations, query, sortOrder)
      : listFolderContents(index, presentations, folderId, sortOrder);
    return filterByType(listed, typeFilter);
  }, [isTrash, index, presentations, query, sortOrder, folderId, typeFilter]);

  const isFiltered = !isTrash && typeFilter !== "all";
  const showTrashFolder =
    !isTrash && folderId === null && !query && typeFilter !== "file";
  const trashCount = useMemo(
    () =>
      showTrashFolder || isTrash ? listTrash(index, presentations).length : 0,
    [showTrashFolder, isTrash, index, presentations],
  );

  const keys = useMemo(() => items.map((item) => item.key), [items]);
  const selectedItems = items.filter((item) => drive.selection.has(item.key));
  const tabStopKey =
    drive.focusKey !== null && keys.includes(drive.focusKey)
      ? drive.focusKey
      : (keys[0] ?? null);

  const present = useCallback(
    (id: string) => startPresentation(id, navigate, pathname),
    [navigate, pathname],
  );

  const open = useCallback(
    (item: DriveItem): void => {
      if (isTrash) {
        drive.showToast("휴지통에 있는 항목은 복원한 뒤 열 수 있습니다");
        return;
      }
      openItem(toRef(item), navigate);
    },
    [isTrash, drive, navigate],
  );

  const focusRow = useCallback((key: string): void => {
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-item-key="${key}"]`,
    );
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const trashFolderActions: MenuAction[] = [
    {
      key: "open",
      label: "열기",
      icon: "open",
      shortcut: "Enter",
      testId: "action-open",
      onSelect: () => navigate(TRASH_PATH),
    },
    {
      key: "empty-trash",
      label: "휴지통 비우기",
      icon: "trash",
      danger: true,
      separated: true,
      disabled: trashCount === 0,
      testId: "action-empty-trash",
      onSelect: () => drive.requestEmptyTrash(),
    },
  ];

  const actionsFor = (targets: DriveItem[]): MenuAction[] => {
    const refs = targets.map(toRef);
    const single = targets.length === 1 ? targets[0] : null;
    const allFiles = targets.every((item) => item.kind === "file");

    if (isTrash) {
      return [
        {
          key: "restore",
          label: "복원",
          icon: "restore",
          testId: "action-restore",
          onSelect: () => drive.restore(refs),
        },
        {
          key: "delete-forever",
          label: "영구 삭제",
          icon: "trash",
          danger: true,
          shortcut: "Delete",
          testId: "action-delete-forever",
          onSelect: () => drive.requestDeleteForever(refs),
        },
      ];
    }

    const actions: MenuAction[] = [];
    if (single) {
      actions.push({
        key: "open",
        label: single.kind === "folder" ? "열기" : "편집기에서 열기",
        icon: "open",
        shortcut: "Enter",
        testId: "action-open",
        onSelect: () => open(single),
      });
      if (single.kind === "file") {
        actions.push({
          key: "present",
          label: "발표",
          icon: "play",
          testId: "action-present",
          onSelect: () => present(single.id),
        });
      }
      actions.push({
        key: "rename",
        label: "이름 바꾸기",
        icon: "pencil",
        shortcut: "F2",
        separated: true,
        testId: "action-rename",
        onSelect: () => drive.requestRename(toRef(single)),
      });
    }
    actions.push({
      key: "move",
      label: "이동",
      icon: "folderOpen",
      shortcut: "Z",
      separated: !single,
      testId: "action-move",
      onSelect: () => drive.requestMove(refs),
    });
    if (allFiles) {
      actions.push({
        key: "duplicate",
        label: "사본 만들기",
        icon: "duplicate",
        testId: "action-duplicate",
        onSelect: () => drive.duplicate(refs),
      });
    }
    actions.push({
      key: "trash",
      label: "휴지통으로 이동",
      icon: "trash",
      danger: true,
      separated: true,
      shortcut: "Delete",
      testId: "action-trash",
      onSelect: () => drive.trash(refs),
    });
    return actions;
  };

  const targetsFor = (item: DriveItem): DriveItem[] => {
    if (drive.selection.has(item.key)) return selectedItems;
    drive.setSelection([item.key], item.key);
    return [item];
  };

  const openMenuFor = (item: DriveItem): void => {
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-item-key="${item.key}"]`,
    );
    const rect = row?.getBoundingClientRect();
    setMenu({
      anchor: { x: (rect?.left ?? 0) + 48, y: rect?.bottom ?? 0 },
      actions: actionsFor(targetsFor(item)),
      fromKeyboard: true,
    });
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
    onContextMenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenu({
        anchor: { x: event.clientX, y: event.clientY },
        actions: actionsFor(targetsFor(item)),
      });
    },
    onFocus: () => {
      if (drive.focusKey !== item.key) drive.setFocusKey(item.key);
    },
    onMore: (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({
        anchor: { x: rect.right - 240, y: rect.bottom + 4 },
        actions: actionsFor(targetsFor(item)),
      });
    },
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
    enabled: !drive.dialogOpen && !menu && !drive.activeDrag,
    open,
    focusRow,
    openMenuFor,
  });

  const marquee = useMarqueeSelection({
    containerRef,
    enabled: !drive.activeDrag,
    selection: drive.selection,
    onSelect: (next) => drive.setSelection(next, next[0] ?? null),
  });

  const folderCount = items.filter((item) => item.kind === "folder").length;
  const fileCount = items.length - folderCount;
  const summary = query
    ? `‘${query}’ 검색 결과 ${items.length}개`
    : `폴더 ${folderCount}개 · 프레젠테이션 ${fileCount}개`;
  const variant = isTrash || query ? "location" : "owner";

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
        onSelectionMore={(anchor) =>
          setMenu({ anchor, actions: actionsFor(selectedItems) })
        }
        summary={summary}
        typeFilter={typeFilter}
        onTypeFilterChange={onTypeFilterChange}
        canEmptyTrash={trashCount > 0}
        onEmptyTrash={() => drive.requestEmptyTrash()}
      />

      <div
        ref={containerRef}
        data-testid="drive-scroll-area"
        className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-16 select-none sm:px-6"
        onMouseDown={marquee.onMouseDown}
        onClick={() => {
          if (marquee.consumeClick()) return;
          drive.clearSelection();
        }}
        onContextMenu={(event) => {
          if (isTrash || query) return;
          event.preventDefault();
          drive.clearSelection();
          setMenu({
            anchor: { x: event.clientX, y: event.clientY },
            actions: newActions,
          });
        }}
      >
        {(items.length > 0 || showTrashFolder) && (
          <>
            <DriveListHeader
              variant={variant}
              secondLabel={isTrash ? "원래 위치" : query ? "위치" : "소유자"}
              dateLabel={isTrash ? "삭제일" : "수정일"}
              sort={isTrash ? undefined : sortOrder}
              onSort={
                isTrash
                  ? undefined
                  : (key) => onSortOrderChange(nextSortOrder(sortOrder, key))
              }
            />
            {showTrashFolder && (
              <TrashFolderRow
                count={trashCount}
                onOpen={() => navigate(TRASH_PATH)}
                onMenu={(anchor) => {
                  drive.clearSelection();
                  setMenu({ anchor, actions: trashFolderActions });
                }}
              />
            )}
            {items.length > 0 && (
              <div
                role="listbox"
                aria-multiselectable="true"
                aria-label={isTrash ? "휴지통" : "폴더와 프레젠테이션"}
              >
                {items.map((item) => (
                  <DriveListRow
                    key={item.key}
                    item={item}
                    variant={variant}
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
      </div>

      {marquee.box && (
        <div
          data-testid="drive-marquee"
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-sm border border-emerald-500 bg-emerald-500/15"
          style={{
            left: marquee.box.left,
            top: marquee.box.top,
            width: marquee.box.right - marquee.box.left,
            height: marquee.box.bottom - marquee.box.top,
          }}
        />
      )}

      {menu && (
        <PopoverMenu
          anchor={menu.anchor}
          actions={menu.actions}
          autoFocusFirst={menu.fromKeyboard}
          onClose={() => setMenu(null)}
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

  let icon: React.ReactNode = (
    <FolderGlyph className="size-10 text-emerald-500/80 dark:text-emerald-400/70" />
  );
  let title: string;
  let hint: string;
  if (query) {
    icon = <Icon name="search" className="size-10" strokeWidth={1.5} />;
    title = `"${query}"에 일치하는 항목이 없습니다.`;
    hint =
      "다른 검색어를 입력해 보세요. 폴더 이름, 세트 제목, 곡 제목·가사로 찾을 수 있습니다.";
  } else if (filtered) {
    title = "선택한 유형의 항목이 없습니다";
    hint = "유형 필터를 지우면 모든 항목을 볼 수 있습니다.";
  } else if (mode === "trash") {
    icon = <Icon name="trash" className="size-10" strokeWidth={1.5} />;
    title = "휴지통이 비어 있습니다";
    hint = "삭제한 폴더와 프레젠테이션이 여기에 모입니다.";
  } else if (drive.currentFolderId) {
    title = "이 폴더가 비어 있습니다";
    hint =
      "새 폴더나 프레젠테이션을 만들거나, 다른 항목을 이 폴더로 끌어다 놓으세요.";
  } else {
    title = "아직 프레젠테이션이 없습니다";
    hint =
      "새 프레젠테이션을 만들어 예배 세트를 준비해 보세요. 폴더로 정리할 수도 있습니다.";
  }

  return (
    <div
      data-testid="drive-empty"
      className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
    >
      <div className="mb-2 text-zinc-400 dark:text-zinc-500">{icon}</div>
      <p className="text-lg text-zinc-800 dark:text-zinc-200">{title}</p>
      <p className="max-w-md text-sm text-zinc-500">{hint}</p>
      {mode === "drive" && !query && !filtered && (
        <div className="flex items-center gap-2 pt-3">
          {newActions.map((action) => (
            <button
              key={action.key}
              type="button"
              data-testid={`empty-${action.key}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                action.onSelect();
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                action.key === "new-presentation"
                  ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-500"
                  : "border border-zinc-300 text-zinc-700 hover:bg-zinc-200/70 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              {action.icon && <Icon name={action.icon} className="size-4" />}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
