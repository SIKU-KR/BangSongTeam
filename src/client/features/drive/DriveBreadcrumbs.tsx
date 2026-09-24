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
      className={`max-w-[180px] truncate px-2 py-1 rounded-lg transition-colors cursor-pointer ${
        isDropTarget
          ? "ring-2 ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
          : isCurrent
            ? "text-zinc-900 dark:text-white"
            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
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
        className="flex items-center min-w-0 text-base font-bold tracking-tight"
      >
        <Crumb
          folderId={null}
          label={ROOT_LABEL}
          isCurrent={false}
          onNavigate={() => navigate(drivePath(null))}
        />
        <Icon
          name="chevronRight"
          className="w-4 h-4 text-zinc-400 shrink-0"
          strokeWidth={2.5}
        />
        <span
          data-testid="crumb-trash"
          aria-current="page"
          className="px-2 py-1 text-zinc-900 dark:text-white"
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
      className="flex items-center min-w-0 text-base font-bold tracking-tight"
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
            className="w-4 h-4 text-zinc-400 shrink-0"
            strokeWidth={2.5}
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
        className="p-1 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/60 cursor-pointer shrink-0"
      >
        <Icon name="chevronDown" className="w-4 h-4" strokeWidth={2.5} />
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
