import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePresentationList } from "../presentation";
import { useAppShell } from "../../routes/appShellContext";
import { useFolderIndex } from "./folderStore";
import { useDrive } from "./driveContext";
import { TRASH_PATH, openItem, startPresentation } from "./driveActions";
import {
  listFolderContents,
  listTrash,
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
import { PopoverMenu, type MenuAction } from "./PopoverMenu";
import { useNewItemActions } from "./NewMenu";
import { FolderGlyph, Icon, type IconName } from "./icons";

export interface DriveBrowserProps {
  mode: "drive" | "trash";
  folderId?: string | null;
}

interface MenuState {
  anchor: { x: number; y: number };
  actions: MenuAction[];
}

function toRef(item: DriveItem): DriveItemRef {
  return { kind: item.kind, id: item.id };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * 드라이브 본문 (폴더 내용 / 검색 결과 / 휴지통).
 *
 * 폴더와 파일을 한 목록에 섞어 보여 준다. 섹션을 나누지 않는다.
 * - 클릭: 선택 · Ctrl/⌘+클릭: 추가·해제 · Shift+클릭: 범위 · 더블클릭: 열기
 * - 우클릭·⋮: 메뉴 · 끌어서 폴더·경로·고정된 휴지통 폴더에 놓기
 * - Esc, ⌘/Ctrl+A, Enter, F2, Delete
 */
export function DriveBrowser({
  mode,
  folderId = null,
}: DriveBrowserProps): React.JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { searchQuery, sortOrder } = useAppShell();
  const presentations = usePresentationList();
  const index = useFolderIndex();
  const drive = useDrive();
  const newActions = useNewItemActions();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const query = searchQuery.trim();
  const isTrash = mode === "trash";
  const items = useMemo(() => {
    if (isTrash) return listTrash(index, presentations, query);
    if (query) return searchDrive(index, presentations, query, sortOrder);
    return listFolderContents(index, presentations, folderId, sortOrder);
  }, [isTrash, index, presentations, query, sortOrder, folderId]);

  const showTrashFolder = !isTrash && folderId === null && !query;
  const trashCount = useMemo(
    () => (showTrashFolder ? listTrash(index, presentations).length : 0),
    [showTrashFolder, index, presentations],
  );

  const keys = useMemo(() => items.map((item) => item.key), [items]);
  const selectedItems = items.filter((item) => drive.selection.has(item.key));

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

  const trashFolderActions: MenuAction[] = [
    {
      key: "open",
      label: "열기",
      icon: "open",
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
        separated: true,
        testId: "action-rename",
        onSelect: () => drive.requestRename(toRef(single)),
      });
    }
    actions.push({
      key: "move",
      label: "이동",
      icon: "folderOpen",
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

  const handlersFor = (item: DriveItem): DriveItemHandlers => ({
    selected: drive.selection.has(item.key),
    interactive: !isTrash,
    onClick: (event) => {
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(drive.selection);
        if (next.has(item.key)) next.delete(item.key);
        else next.add(item.key);
        drive.setSelection([...next], item.key);
        return;
      }
      if (event.shiftKey && drive.anchorKey && keys.includes(drive.anchorKey)) {
        const from = keys.indexOf(drive.anchorKey);
        const to = keys.indexOf(item.key);
        const [start, end] = from < to ? [from, to] : [to, from];
        drive.setSelection(keys.slice(start, end + 1));
        return;
      }
      drive.setSelection([item.key], item.key);
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
    onMore: (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({
        anchor: { x: rect.right - 200, y: rect.bottom + 4 },
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

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (drive.dialogOpen || menu || isTypingTarget(event.target)) return;
      const selected = items.filter((item) => drive.selection.has(item.key));

      if (event.key === "Escape") {
        drive.clearSelection();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "a") {
        event.preventDefault();
        drive.setSelection(keys, keys[0] ?? null);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (selected.length === 0) return;
        event.preventDefault();
        if (isTrash) drive.requestDeleteForever(selected.map(toRef));
        else drive.trash(selected.map(toRef));
      } else if (event.key === "Enter" && selected.length === 1) {
        event.preventDefault();
        open(selected[0]);
      } else if (event.key === "F2" && selected.length === 1 && !isTrash) {
        event.preventDefault();
        drive.requestRename(toRef(selected[0]));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [drive, menu, items, keys, isTrash, open]);

  const folderCount = items.filter((item) => item.kind === "folder").length;
  const fileCount = items.length - folderCount;

  return (
    <div
      data-testid={isTrash ? "trash-view" : "drive-view"}
      className="min-h-[60vh] space-y-4"
      onClick={() => drive.clearSelection()}
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
      <div className="h-11 flex items-center">
        {selectedItems.length > 0 ? (
          <SelectionBar
            count={selectedItems.length}
            actions={actionsFor(selectedItems)}
            onClear={() => drive.clearSelection()}
          />
        ) : (
          <div className="flex items-center justify-between w-full gap-3 px-1">
            <p className="text-xs text-zinc-500" data-testid="drive-summary">
              {isTrash
                ? "휴지통의 항목은 영구 삭제하기 전까지 언제든 복원할 수 있습니다."
                : query
                  ? `‘${query}’ 검색 결과 ${items.length}개`
                  : `폴더 ${folderCount}개 · 프레젠테이션 ${fileCount}개`}
            </p>
            {isTrash && (
              <button
                type="button"
                data-testid="empty-trash-btn"
                disabled={items.length === 0 && !query}
                onClick={(event) => {
                  event.stopPropagation();
                  drive.requestEmptyTrash();
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                휴지통 비우기
              </button>
            )}
          </div>
        )}
      </div>

      {(items.length > 0 || showTrashFolder) && (
        <div className="border border-zinc-200 dark:border-zinc-800/80 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900/40 shadow-sm">
          <DriveListHeader dateLabel={isTrash ? "삭제일" : "수정일"} />
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
              className="divide-y divide-zinc-200 dark:divide-zinc-800/60"
            >
              {items.map((item) => (
                <DriveListRow
                  key={item.key}
                  item={item}
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
        </div>
      )}

      {items.length === 0 && <EmptyState mode={mode} query={query} />}

      {menu && (
        <PopoverMenu
          anchor={menu.anchor}
          actions={menu.actions}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

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
      onClick={(event) => event.stopPropagation()}
      className="w-full h-11 px-1.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center gap-1 overflow-x-auto"
    >
      <button
        type="button"
        aria-label="선택 해제"
        data-testid="selection-clear"
        onClick={onClear}
        className="p-2 rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
      >
        <Icon name="close" className="w-4 h-4" />
      </button>
      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 pr-2 whitespace-nowrap">
        {count}개 선택됨
      </span>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          data-testid={action.testId ? `bar-${action.testId}` : undefined}
          onClick={action.onSelect}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
            action.danger
              ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          {action.icon && (
            <Icon name={action.icon as IconName} className="w-4 h-4" />
          )}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  mode,
  query,
}: {
  mode: "drive" | "trash";
  query: string;
}): React.JSX.Element {
  const drive = useDrive();
  const newActions = useNewItemActions();

  let icon: React.ReactNode = (
    <FolderGlyph className="w-6 h-6 text-emerald-500/80 dark:text-emerald-400/70" />
  );
  let title: string;
  let hint: string;
  if (query) {
    icon = <Icon name="search" className="w-6 h-6" strokeWidth={1.5} />;
    title = `"${query}"에 일치하는 항목이 없습니다.`;
    hint =
      "다른 검색어를 입력해 보세요. 폴더 이름, 세트 제목, 곡 제목·가사로 찾을 수 있습니다.";
  } else if (mode === "trash") {
    icon = <Icon name="trash" className="w-6 h-6" strokeWidth={1.5} />;
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
      className="py-16 px-6 text-center flex flex-col items-center justify-center gap-3 border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-950/40"
    >
      <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/80 flex items-center justify-center text-zinc-500 mb-1">
        {icon}
      </div>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-300">
        {title}
      </p>
      <p className="text-xs text-zinc-500 max-w-md">{hint}</p>
      {mode === "drive" && !query && (
        <div className="flex items-center gap-2 pt-2">
          {newActions.map((action) => (
            <button
              key={action.key}
              type="button"
              data-testid={`empty-${action.key}`}
              onClick={(event) => {
                event.stopPropagation();
                action.onSelect();
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                action.key === "new-presentation"
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
                  : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
              }`}
            >
              {action.icon && <Icon name={action.icon} className="w-4 h-4" />}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
