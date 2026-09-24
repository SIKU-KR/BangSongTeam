import { createContext, useContext } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getFolderIndex } from "./folderStore";
import { canDropInto, type DriveItemRef } from "./driveModel";
import { parentOf } from "./driveActions";

/** 드래그한 항목을 놓을 수 있는 곳 */
export type DropTarget =
  { kind: "folder"; folderId: string | null } | { kind: "trash" };

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface DriveContextValue {
  /** 지금 보고 있는 폴더 (`null` = 루트 또는 드라이브가 아닌 화면) */
  currentFolderId: string | null;
  isTrashView: boolean;

  /** 선택된 항목 키 (`folder:<id>` / `file:<id>`) */
  selection: ReadonlySet<string>;
  /** Shift+클릭 범위 선택의 기준 */
  anchorKey: string | null;
  setSelection: (keys: readonly string[], anchor?: string | null) => void;
  clearSelection: () => void;

  /** 끌고 있는 항목 (없으면 null) */
  activeDrag: readonly DriveItemRef[] | null;
  /** 대화 상자가 열려 있는지 (단축키를 막는다) */
  dialogOpen: boolean;

  requestNewFolder: (parentId: string | null) => void;
  requestRename: (ref: DriveItemRef) => void;
  requestMove: (refs: DriveItemRef[]) => void;
  requestDeleteForever: (refs: DriveItemRef[]) => void;
  requestEmptyTrash: () => void;

  createPresentationIn: (folderId: string | null) => void;
  trash: (refs: DriveItemRef[]) => void;
  restore: (refs: DriveItemRef[]) => void;
  move: (refs: DriveItemRef[], targetFolderId: string | null) => void;
  duplicate: (refs: DriveItemRef[]) => void;
  showToast: (message: string, action?: ToastAction) => void;
}

export const DriveContext = createContext<DriveContextValue | null>(null);

export function useDrive(): DriveContextValue {
  const value = useContext(DriveContext);
  if (!value) {
    throw new Error("useDrive는 DriveProvider 안에서만 쓸 수 있습니다");
  }
  return value;
}

/** 끌어 온 항목을 이 대상에 놓으면 실제로 무언가 바뀌는지 */
export function canDropOn(
  refs: readonly DriveItemRef[] | null,
  target: DropTarget,
): boolean {
  if (!refs || refs.length === 0) return false;
  if (target.kind === "trash") return true;
  return (
    canDropInto(getFolderIndex(), refs, target.folderId) &&
    refs.some((ref) => parentOf(ref) !== target.folderId)
  );
}

/**
 * 드롭 대상 (폴더 카드·브레드크럼·사이드바 트리·휴지통).
 * `isDropTarget`은 지금 끌고 있는 항목을 여기 놓을 수 있고 포인터가 올라와 있을 때.
 */
export function useDriveDroppable(
  id: string,
  target: DropTarget,
  disabled = false,
): {
  setNodeRef: (node: HTMLElement | null) => void;
  isDropTarget: boolean;
} {
  const { activeDrag } = useDrive();
  const allowed = !disabled && canDropOn(activeDrag, target);
  // 드래그 도중에 활성 여부를 바꾸면 dnd-kit이 다시 측정해야 한다. 대상은 늘
  // 켜 두고, 놓을 수 있는지는 강조와 드롭 처리에서 가린다.
  const { setNodeRef, isOver } = useDroppable({ id, data: target, disabled });
  return { setNodeRef, isDropTarget: allowed && isOver };
}

/** 끌 수 있는 항목. 키보드 드래그는 쓰지 않으므로 포인터 리스너만 건다 */
export function useDriveDraggable(
  key: string,
  disabled = false,
): {
  setNodeRef: (node: HTMLElement | null) => void;
  listeners: ReturnType<typeof useDraggable>["listeners"];
  isDragging: boolean;
} {
  const { activeDrag } = useDrive();
  const { setNodeRef, listeners } = useDraggable({ id: key, disabled });
  const isDragging =
    activeDrag?.some((ref) => `${ref.kind}:${ref.id}` === key) ?? false;
  return { setNodeRef, listeners, isDragging };
}
