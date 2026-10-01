import React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronDownIcon,
  FolderInputIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "cn";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#components/ui/breadcrumb";
import { Button } from "#components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import { getFolderPath } from "#shared";
import { useFolderIndex } from "./folderStore";
import { useDrive, useDriveDroppable } from "./driveContext";
import { drivePath } from "./drivePaths";
import type { DriveItemRef } from "./driveModel";
import {
  ActionMenuItems,
  type MenuAction,
} from "#components/common/ActionMenu";
import { useNewItemActions } from "./NewMenu";
import { DRIVE_COPY } from "#copy/drive";
import { COMMON_COPY } from "#copy/common";

function Crumb({
  folderId,
  label,
  isCurrent,
}: {
  folderId: string | null;
  label: string;
  isCurrent: boolean;
}): React.JSX.Element {
  const { setNodeRef, isDropTarget } = useDriveDroppable(
    `crumb:${folderId ?? "root"}`,
    { kind: "folder", folderId },
  );
  const testId = `crumb-${folderId ?? "root"}`;
  return (
    <BreadcrumbItem
      ref={setNodeRef}
      className={cn(isDropTarget && "rounded-md ring-2 ring-ring")}
    >
      {isCurrent ? (
        <BreadcrumbPage data-testid={testId}>{label}</BreadcrumbPage>
      ) : (
        <BreadcrumbLink
          data-testid={testId}
          render={<Link to={drivePath(folderId)} />}
        >
          {label}
        </BreadcrumbLink>
      )}
    </BreadcrumbItem>
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
            label: DRIVE_COPY.rename,
            icon: PencilIcon,
            shortcut: "F2",
            separated: true,
            onSelect: () => drive.requestRename(ref),
          },
          {
            key: "move",
            label: DRIVE_COPY.move,
            icon: FolderInputIcon,
            onSelect: () => drive.requestMove([ref]),
          },
          {
            key: "trash",
            label: DRIVE_COPY.moveToTrash,
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
      <Breadcrumb
        aria-label={DRIVE_COPY.breadcrumbs}
        data-testid="drive-breadcrumbs"
      >
        <BreadcrumbList className="text-xl">
          <Crumb
            folderId={null}
            label={COMMON_COPY.myDrive}
            isCurrent={false}
          />
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage data-testid="crumb-trash">
              {COMMON_COPY.trash}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb
      aria-label={DRIVE_COPY.breadcrumbs}
      data-testid="drive-breadcrumbs"
    >
      <BreadcrumbList className="text-xl">
        <Crumb
          folderId={null}
          label={COMMON_COPY.myDrive}
          isCurrent={current === null}
        />
        {path.map((folder, i) => (
          <React.Fragment key={folder.id}>
            <BreadcrumbSeparator />
            <Crumb
              folderId={folder.id}
              label={folder.name}
              isCurrent={i === path.length - 1}
            />
          </React.Fragment>
        ))}
        <BreadcrumbItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="breadcrumb-menu-btn"
              aria-label={DRIVE_COPY.currentFolderMenu}
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-testid="drive-menu"
              aria-label={DRIVE_COPY.currentFolder}
              className="min-w-60"
            >
              <ActionMenuItems actions={[...newActions, ...folderActions]} />
            </DropdownMenuContent>
          </DropdownMenu>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
