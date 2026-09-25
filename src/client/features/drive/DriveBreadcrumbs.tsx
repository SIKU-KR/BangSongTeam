import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderInputIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import { getFolderPath } from "#shared";
import { useFolderIndex } from "./folderStore";
import { useDrive, useDriveDroppable } from "./driveContext";
import { drivePath } from "./driveActions";
import { ROOT_LABEL, type DriveItemRef } from "./driveModel";
import { ActionMenuItems, type MenuAction } from "./ActionMenu";
import { useNewItemActions } from "./NewMenu";

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
    <Button
      ref={setNodeRef}
      variant="ghost"
      data-testid={`crumb-${folderId ?? "root"}`}
      aria-current={isCurrent ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "h-auto max-w-60 truncate rounded-full px-3 py-1 text-2xl font-normal",
        isCurrent ? "text-foreground" : "text-muted-foreground",
        isDropTarget && "bg-primary/5 ring-2 ring-primary",
      )}
    >
      <span className="truncate">{label}</span>
    </Button>
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
            icon: PencilIcon,
            shortcut: "F2",
            separated: true,
            onSelect: () => drive.requestRename(ref),
          },
          {
            key: "move",
            label: "이동",
            icon: FolderInputIcon,
            onSelect: () => drive.requestMove([ref]),
          },
          {
            key: "trash",
            label: "휴지통으로 이동",
            icon: Trash2Icon,
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
        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
        <span
          data-testid="crumb-trash"
          aria-current="page"
          className="px-3 py-1"
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
          <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
          <Crumb
            folderId={folder.id}
            label={folder.name}
            isCurrent={i === path.length - 1}
            onNavigate={() => navigate(drivePath(folder.id))}
          />
        </React.Fragment>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="breadcrumb-menu-btn"
          aria-label="현재 폴더 메뉴"
          render={
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 rounded-full text-muted-foreground"
            />
          }
        >
          <ChevronDownIcon className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-testid="drive-menu"
          aria-label="현재 폴더"
          className="min-w-60"
        >
          <ActionMenuItems actions={[...newActions, ...folderActions]} />
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
