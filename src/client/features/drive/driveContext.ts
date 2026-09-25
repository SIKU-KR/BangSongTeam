import { createContext, useContext } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getFolderIndex } from "./folderStore";
import { canDropInto, type DriveItemRef } from "./driveModel";
import { parentOf } from "./driveActions";

export type DropTarget =
  { kind: "folder"; folderId: string | null } | { kind: "trash" };

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface DriveContextValue {
  currentFolderId: string | null;
  isTrashView: boolean;

  selection: ReadonlySet<string>;
  /** Shift 범위 선택의 기준점 */
  anchorKey: string | null;
  /** 키보드 커서. 선택과 따로 움직인다 (Ctrl+방향키) */
  focusKey: string | null;
  /** 선택을 바꾼다. `anchor`를 넘기면 기준점과 포커스를 함께 옮긴다 */
  setSelection: (keys: readonly string[], anchor?: string | null) => void;
  setFocusKey: (key: string | null) => void;
  clearSelection: () => void;

  activeDrag: readonly DriveItemRef[] | null;
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

/** 드롭 대상 (폴더 행·브레드크럼·사이드바 내 드라이브·휴지통 폴더). */
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
