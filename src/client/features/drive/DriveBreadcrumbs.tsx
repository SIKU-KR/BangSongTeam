import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFolderPath } from "#shared";
import { useFolderIndex } from "./folderStore";
import { useDrive, useDriveDroppable } from "./driveContext";
import { drivePath } from "./driveActions";
import { ROOT_LABEL, type DriveItemRef } from "./driveModel";
import { PopoverMenu, type MenuAction } from "./PopoverMenu";
import { useNewItemActions } from "./NewMenu";
import { Icon } from "./icons";

function Crumb({
  folderId,
  label,
  isCurrent,
  onNavigate,
}: {
  folderId: string | null;
  label: string;
  isCurrent: boolean;
  onNavigate: () => void;
}): React.JSX.Element {
  const { setNodeRef, isDropTarget } = useDriveDroppable(
    `crumb:${folderId ?? "root"}`,
    { kind: "folder", folderId },
  );
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={`crumb-${folderId ?? "root"}`}
      aria-current={isCurrent ? "page" : undefined}
      onClick={onNavigate}
      title={label}
      className={`max-w-[240px] cursor-pointer truncate rounded-full px-3 py-1 transition-colors ${
        isDropTarget
          ? "bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200"
          : isCurrent
            ? "text-zinc-900 hover:bg-zinc-200/70 dark:text-white dark:hover:bg-zinc-800/70"
            : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * 드라이브 경로 (`내 드라이브 › 2026 › 주일 ▾`).
 * 경로 조각마다 드롭 대상이고, 마지막 ▾에서 현재 폴더를 다룬다.
 * 휴지통에서는 `내 드라이브 › 휴지통`만 보이고 ▾ 메뉴가 없다.
 */
export function DriveBreadcrumbs(): React.JSX.Element {
  const navigate = useNavigate();
  const index = useFolderIndex();
  const drive = useDrive();
  const newActions = useNewItemActions();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const path = getFolderPath(index, drive.currentFolderId);
  const current = path[path.length - 1] ?? null;

  const folderActions: MenuAction[] = current
    ? (() => {
        const ref: DriveItemRef = { kind: "folder", id: current.id };
        const parentId = index.parentOf.get(current.id) ?? null;
        return [
          {
            key: "rename",
            label: "이름 바꾸기",
            icon: "pencil",
            shortcut: "F2",
            separated: true,
            onSelect: () => drive.requestRename(ref),
          },
          {
            key: "move",
            label: "이동",
            icon: "folderOpen",
            onSelect: () => drive.requestMove([ref]),
          },
          {
            key: "trash",
            label: "휴지통으로 이동",
            icon: "trash",
            danger: true,
            separated: true,
            onSelect: () => {
              drive.trash([ref]);
              navigate(drivePath(parentId));
            },
          },
        ];
      })()
    : [];

  if (drive.isTrashView) {
    return (
      <nav
        aria-label="드라이브 경로"
        data-testid="drive-breadcrumbs"
        className="flex min-w-0 items-center text-2xl"
      >
        <Crumb
          folderId={null}
          label={ROOT_LABEL}
          isCurrent={false}
          onNavigate={() => navigate(drivePath(null))}
        />
        <Icon
          name="chevronRight"
          className="size-5 shrink-0 text-zinc-400"
          strokeWidth={2}
        />
        <span
          data-testid="crumb-trash"
          aria-current="page"
          className="px-3 py-1 text-zinc-900 dark:text-white"
        >
          휴지통
        </span>
      </nav>
    );
  }

  return (
    <nav
      aria-label="드라이브 경로"
      data-testid="drive-breadcrumbs"
      className="flex min-w-0 items-center text-2xl"
    >
      <Crumb
        folderId={null}
        label={ROOT_LABEL}
        isCurrent={current === null}
        onNavigate={() => navigate(drivePath(null))}
      />
      {path.map((folder, i) => (
        <React.Fragment key={folder.id}>
          <Icon
            name="chevronRight"
            className="size-5 shrink-0 text-zinc-400"
            strokeWidth={2}
          />
          <Crumb
            folderId={folder.id}
            label={folder.name}
            isCurrent={i === path.length - 1}
            onNavigate={() => navigate(drivePath(folder.id))}
          />
        </React.Fragment>
      ))}
      <button
        ref={triggerRef}
        type="button"
        data-testid="breadcrumb-menu-btn"
        aria-label="현재 폴더 메뉴"
        aria-haspopup="menu"
        onClick={(event) => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 6 });
        }}
        className="-ml-1 shrink-0 cursor-pointer rounded-full p-1.5 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-white"
      >
        <Icon name="chevronDown" className="size-5" strokeWidth={2} />
      </button>
      {anchor && (
        <PopoverMenu
          anchor={anchor}
          actions={[...newActions, ...folderActions]}
          label="현재 폴더"
          triggerRef={triggerRef}
          onClose={() => setAnchor(null)}
        />
      )}
    </nav>
  );
}
