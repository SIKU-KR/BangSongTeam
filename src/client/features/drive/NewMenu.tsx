import React from "react";
import { FilePlusIcon, FolderPlusIcon, PlusIcon } from "lucide-react";
import { Button } from "#components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import { useDrive } from "./driveContext";
import { ActionMenuItems, type MenuAction } from "./ActionMenu";
import { DRIVE_COPY } from "#copy/drive";
import { FOLDER_COPY } from "#copy/folders";
import { COMMON_COPY } from "#copy/common";

export function useNewItemActions(): MenuAction[] {
  const drive = useDrive();
  const target = drive.isTrashView ? null : drive.currentFolderId;
  return [
    {
      key: "new-folder",
      label: FOLDER_COPY.newFolder,
      icon: FolderPlusIcon,
      shortcut: "Shift+F",
      testId: "new-menu-folder",
      onSelect: () => drive.requestNewFolder(target),
    },
    {
      key: "new-presentation",
      label: COMMON_COPY.newPresentation,
      icon: FilePlusIcon,
      shortcut: "Shift+P",
      testId: "new-menu-presentation",
      onSelect: () => drive.createPresentationIn(target),
    },
  ];
}

/**
 * '새로 만들기' 버튼 (드라이브의 '+ 신규').
 * - `sidebar`: 사이드바 상단의 넓은 버튼
 * - `fab`: 사이드바가 숨는 좁은 화면에서 제목 줄 오른쪽 + 버튼
 */
export function NewMenuButton({
  variant,
  testId,
}: {
  variant: "sidebar" | "fab";
  testId?: string;
}): React.JSX.Element {
  const actions = useNewItemActions();

  const trigger =
    variant === "sidebar" ? (
      <DropdownMenuTrigger
        data-testid={testId}
        render={
          <Button
            variant="outline"
            size="lg"
            className="w-full justify-start"
          />
        }
      >
        <PlusIcon />
        {DRIVE_COPY.newItem}
      </DropdownMenuTrigger>
    ) : (
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              data-testid={testId}
              aria-label={DRIVE_COPY.newItem}
              render={<Button size="icon" />}
            />
          }
        >
          <PlusIcon />
        </TooltipTrigger>
        <TooltipContent>{DRIVE_COPY.newItem}</TooltipContent>
      </Tooltip>
    );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent
        data-testid="new-menu"
        aria-label={DRIVE_COPY.newItem}
        align={variant === "sidebar" ? "start" : "end"}
        className="min-w-60"
      >
        <ActionMenuItems actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
