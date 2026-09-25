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
import { drivePath } from "./driveActions";
import { ROOT_LABEL, type DriveItemRef } from "./driveModel";
import { ActionMenuItems, type MenuAction } from "./ActionMenu";
import { useNewItemActions } from "./NewMenu";

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
      <Breadcrumb aria-label="드라이브 경로" data-testid="drive-breadcrumbs">
        <BreadcrumbList className="text-xl">
          <Crumb folderId={null} label={ROOT_LABEL} isCurrent={false} />
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage data-testid="crumb-trash">휴지통</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb aria-label="드라이브 경로" data-testid="drive-breadcrumbs">
      <BreadcrumbList className="text-xl">
        <Crumb
          folderId={null}
          label={ROOT_LABEL}
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
              aria-label="현재 폴더 메뉴"
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-testid="drive-menu"
              aria-label="현재 폴더"
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
