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

export function useNewItemActions(): MenuAction[] {
  const drive = useDrive();
  const target = drive.isTrashView ? null : drive.currentFolderId;
  return [
    {
      key: "new-folder",
      label: "새 폴더",
      icon: FolderPlusIcon,
      shortcut: "Shift+F",
      testId: "new-menu-folder",
      onSelect: () => drive.requestNewFolder(target),
    },
    {
      key: "new-presentation",
      label: "새 프레젠테이션",
      icon: FilePlusIcon,
      shortcut: "Shift+P",
      testId: "new-menu-presentation",
      onSelect: () => drive.createPresentationIn(target),
    },
  ];
}

/**
 * '새로 만들기' 버튼 (드라이브의 '+ 신규').
 * - `sidebar`: 사이드바 상단의 큰 버튼
 * - `fab`: 툴바 오른쪽 원형 + 버튼
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
            className="h-12 gap-3 rounded-2xl pr-6 pl-4 shadow-sm"
          />
        }
      >
        <PlusIcon className="size-5" />
        새로 만들기
      </DropdownMenuTrigger>
    ) : (
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              data-testid={testId}
              aria-label="새로 만들기"
              render={<Button size="icon" className="rounded-full" />}
            />
          }
        >
          <PlusIcon />
        </TooltipTrigger>
        <TooltipContent>새로 만들기</TooltipContent>
      </Tooltip>
    );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent
        data-testid="new-menu"
        aria-label="새로 만들기"
        align={variant === "sidebar" ? "start" : "end"}
        className="min-w-60"
      >
        <ActionMenuItems actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
