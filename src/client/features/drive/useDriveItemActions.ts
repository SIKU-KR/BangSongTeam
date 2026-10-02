import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CopyIcon,
  FolderInputIcon,
  PencilIcon,
  PlayIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useDrive } from "./driveContext";
import { openItem, startPresentation } from "./driveActions";
import { TRASH_PATH } from "./drivePaths";
import { toItemRef, type DriveItem } from "./driveModel";
import type { MenuAction } from "#components/common/ActionMenu";
import { DRIVE_COPY } from "#copy/drive";
import { COMMON_COPY } from "#copy/common";

interface DriveItemActionsOptions {
  isTrash: boolean;
  trashCount: number;
}

interface DriveItemActions {
  present: (id: string) => boolean;
  open: (item: DriveItem) => void;
  /** 고정된 휴지통 폴더의 메뉴 */
  trashFolderActions: MenuAction[];
  /**
   * 선택한 항목들의 메뉴 (우클릭·⋮·선택 툴바가 같은 목록을 쓴다).
   * 렌더마다 새로 만들므로 선택을 바꾼 뒤에 불러야 바뀐 대상을 본다.
   */
  actionsFor: (targets: DriveItem[]) => MenuAction[];
}

/**
 * 드라이브 항목 메뉴의 규칙. 휴지통에서는 복원·영구 삭제만, 드라이브에서는
 * 하나를 고르면 열기·송출·이름 바꾸기가 더해지고 사본은 프레젠테이션만 만든다.
 */
export function useDriveItemActions({
  isTrash,
  trashCount,
}: DriveItemActionsOptions): DriveItemActions {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const drive = useDrive();

  const present = useCallback(
    (id: string) => startPresentation(id, navigate, pathname),
    [navigate, pathname],
  );

  const open = useCallback(
    (item: DriveItem): void => {
      if (isTrash) {
        drive.showToast(DRIVE_COPY.openTrashedItem);
        return;
      }
      openItem(toItemRef(item), navigate);
    },
    [isTrash, drive, navigate],
  );

  const trashFolderActions: MenuAction[] = [
    {
      key: "open",
      label: DRIVE_COPY.open,
      icon: SquareArrowOutUpRightIcon,
      shortcut: "Enter",
      testId: "action-open",
      onSelect: () => navigate(TRASH_PATH),
    },
    {
      key: "empty-trash",
      label: DRIVE_COPY.emptyTrash,
      icon: Trash2Icon,
      danger: true,
      separated: true,
      disabled: trashCount === 0,
      testId: "action-empty-trash",
      onSelect: () => drive.requestEmptyTrash(),
    },
  ];

  const actionsFor = (targets: DriveItem[]): MenuAction[] => {
    const refs = targets.map(toItemRef);
    const single = targets.length === 1 ? targets[0] : null;
    const allFiles = targets.every((item) => item.kind === "file");

    if (isTrash) {
      return [
        {
          key: "restore",
          label: DRIVE_COPY.restore,
          icon: Undo2Icon,
          testId: "action-restore",
          onSelect: () => drive.restore(refs),
        },
        {
          key: "delete-forever",
          label: DRIVE_COPY.deleteForever,
          icon: Trash2Icon,
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
        label:
          single.kind === "folder" ? DRIVE_COPY.open : DRIVE_COPY.openInEditor,
        icon: SquareArrowOutUpRightIcon,
        shortcut: "Enter",
        testId: "action-open",
        onSelect: () => open(single),
      });
      if (single.kind === "file") {
        actions.push({
          key: "present",
          label: DRIVE_COPY.present,
          icon: PlayIcon,
          testId: "action-present",
          onSelect: () => present(single.id),
        });
      }
      actions.push({
        key: "rename",
        label: DRIVE_COPY.rename,
        icon: PencilIcon,
        shortcut: "F2",
        separated: true,
        testId: "action-rename",
        onSelect: () => drive.requestRename(toItemRef(single)),
      });
    }
    actions.push({
      key: "move",
      label: DRIVE_COPY.move,
      icon: FolderInputIcon,
      shortcut: "Z",
      separated: !single,
      testId: "action-move",
      onSelect: () => drive.requestMove(refs),
    });
    if (allFiles) {
      actions.push({
        key: "duplicate",
        label: COMMON_COPY.makeCopy,
        icon: CopyIcon,
        testId: "action-duplicate",
        onSelect: () => drive.duplicate(refs),
      });
    }
    actions.push({
      key: "trash",
      label: DRIVE_COPY.moveToTrash,
      icon: Trash2Icon,
      danger: true,
      separated: true,
      shortcut: "Delete",
      testId: "action-trash",
      onSelect: () => drive.trash(refs),
    });
    return actions;
  };

  return { present, open, trashFolderActions, actionsFor };
}
