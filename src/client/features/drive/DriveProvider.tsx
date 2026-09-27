import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import { FolderIcon, PresentationIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "#components/ui/badge";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { createNewPresentation } from "../presentation";
import {
  createFolder,
  getFolderIndex,
  isFolderAvailable,
  validateFolderName,
} from "./folderStore";
import {
  DriveContext,
  canDropOn,
  type DriveContextValue,
  type DropTarget,
  type ToastAction,
} from "./driveContext";
import {
  deleteItemsForever,
  DriveActionError,
  duplicateItems,
  itemName,
  moveItems,
  parentOf,
  renameItem,
  restoreItems,
  trashItems,
  undoMove,
} from "./driveActions";
import {
  itemKey,
  listTrash,
  parseItemKey,
  type DriveItemRef,
} from "./driveModel";
import { ConfirmDialog, MoveDialog, NameDialog } from "./DriveDialogs";
import { listPresentations } from "../presentation";
import { resolveUniqueName } from "#shared";
import { isLetterKey, isTypingTarget } from "./keyboard";
import { DRIVE_COPY } from "#copy/drive";
import { COMMON_COPY } from "#copy/common";

type DialogState =
  | { kind: "new-folder"; parentId: string | null }
  | { kind: "rename"; ref: DriveItemRef }
  | { kind: "move"; refs: DriveItemRef[] }
  | { kind: "delete-forever"; refs: DriveItemRef[] }
  | { kind: "empty-trash" }
  | null;

const TOAST_ID = "drive-toast";
const TOAST_DURATION_MS = 6000;

const followCursor: Modifier = ({
  activatorEvent,
  activeNodeRect,
  transform,
}) => {
  const origin = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  if (!origin || !activeNodeRect) return transform;
  return {
    ...transform,
    x: transform.x + origin.x - activeNodeRect.left + 12,
    y: transform.y + origin.y - activeNodeRect.top + 12,
  };
};

function describeCount(refs: readonly DriveItemRef[]): string {
  if (refs.length === 1) {
    const name = itemName(refs[0]).trim();
    if (name) return DRIVE_COPY.quoted(name);
  }
  return DRIVE_COPY.itemCount(refs.length);
}

/**
 * 드라이브 상태 공급자 (홈 셸 전체를 감싼다).
 *
 * 사이드바, 헤더 브레드크럼, 본문 목록이 같은 선택·드래그 상태를
 * 봐야 하므로 셸 한 곳에 둔다. 대화 상자와 알림(실행 취소)도 여기서 띄운다.
 */
export function DriveProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const folderMatch = useMatch("/presentations/folders/:folderId");
  const currentFolderId = folderMatch?.params.folderId ?? null;
  const isTrashView = pathname === "/presentations/trash";

  const [selection, setSelectionState] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DriveItemRef[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [undoAction, setUndoAction] = useState<ToastAction | null>(null);

  useEffect(() => {
    setSelectionState(new Set());
    setAnchorKey(null);
    setFocusKey(null);
  }, [pathname]);

  const setSelection = useCallback(
    (keys: readonly string[], anchor?: string | null): void => {
      setSelectionState(new Set(keys));
      if (anchor !== undefined) {
        setAnchorKey(anchor);
        if (anchor !== null) setFocusKey(anchor);
      }
    },
    [],
  );
  const clearSelection = useCallback((): void => {
    setSelectionState(new Set());
    setAnchorKey(null);
  }, []);

  const showToast = useCallback(
    (message: string, action?: ToastAction): void => {
      setUndoAction(action ?? null);
      toast(message, {
        id: TOAST_ID,
        testId: TOAST_ID,
        duration: TOAST_DURATION_MS,
        closeButton: true,
        action: action && {
          label: action.label,
          onClick: () => {
            action.run();
            setUndoAction(null);
          },
        },
        onDismiss: () => setUndoAction(null),
        onAutoClose: () => setUndoAction(null),
      });
    },
    [],
  );

  const trash = useCallback(
    (refs: DriveItemRef[]): void => {
      if (refs.length === 0) return;
      const label = describeCount(refs);
      const trashed = trashItems(refs);
      clearSelection();
      showToast(DRIVE_COPY.toast.trashed(label), {
        label: COMMON_COPY.undo,
        run: () => restoreItems(trashed),
      });
    },
    [clearSelection, showToast],
  );

  const restore = useCallback(
    (refs: DriveItemRef[]): void => {
      if (refs.length === 0) return;
      const label = describeCount(refs);
      restoreItems(refs);
      clearSelection();
      showToast(DRIVE_COPY.toast.restored(label));
    },
    [clearSelection, showToast],
  );

  const move = useCallback(
    (refs: DriveItemRef[], targetFolderId: string | null): void => {
      const label = describeCount(refs);
      const outcome = moveItems(refs, targetFolderId);
      if (outcome.errors.length > 0 && outcome.moved.length === 0) {
        showToast(outcome.errors[0]);
        return;
      }
      if (outcome.moved.length === 0) return;
      const targetName =
        targetFolderId === null
          ? COMMON_COPY.myDrive
          : itemName({ kind: "folder", id: targetFolderId });
      showToast(DRIVE_COPY.toast.moved(label, targetName), {
        label: COMMON_COPY.undo,
        run: () => undoMove(outcome),
      });
    },
    [showToast],
  );

  const duplicate = useCallback(
    (refs: DriveItemRef[]): void => {
      const copies = duplicateItems(refs);
      if (copies.length === 0) return;
      setSelection(
        copies.map((copy) => itemKey("file", copy.id)),
        itemKey("file", copies[0].id),
      );
      showToast(
        copies.length === 1
          ? DRIVE_COPY.toast.duplicated(copies[0].title)
          : DRIVE_COPY.toast.duplicatedMany(copies.length),
      );
    },
    [setSelection, showToast],
  );

  const createPresentationIn = useCallback(
    (folderId: string | null): void => {
      const target = isFolderAvailable(folderId) ? folderId : null;
      const created = createNewPresentation(undefined, target);
      navigate(`/editor/${created.id}`);
    },
    [navigate],
  );

  const runDeleteForever = async (refs: DriveItemRef[]): Promise<void> => {
    if (refs.length === 0) {
      setDialog(null);
      return;
    }
    const label = describeCount(refs);
    setIsDeleting(true);
    try {
      await deleteItemsForever(refs);
      clearSelection();
      setDialog(null);
      showToast(
        refs.length === 1
          ? DRIVE_COPY.toast.deletedForever(label)
          : DRIVE_COPY.toast.deletedForeverMany(refs.length),
      );
    } catch (err) {
      setDialog(null);
      showToast(
        err instanceof DriveActionError
          ? err.message
          : DRIVE_COPY.toast.deleteForeverFailed,
      );
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    const action = undoAction;
    if (!action || dialog !== null) return;
    const handleUndo = (event: KeyboardEvent): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        !isLetterKey(event, "z") ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      action.run();
      toast.dismiss(TOAST_ID);
      setUndoAction(null);
    };
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [undoAction, dialog]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = ({ active }: DragStartEvent): void => {
    const key = String(active.id);
    if (selection.has(key)) {
      setActiveDrag([...selection].map(parseItemKey));
    } else {
      setSelection([key], key);
      setActiveDrag([parseItemKey(key)]);
    }
  };

  const handleDragEnd = ({ over }: DragEndEvent): void => {
    const refs = activeDrag;
    setActiveDrag(null);
    const target = over?.data.current as DropTarget | undefined;
    if (!refs || !target || !canDropOn(refs, target)) return;
    if (target.kind === "trash") trash(refs);
    else move(refs, target.folderId);
  };

  const value = useMemo<DriveContextValue>(
    () => ({
      currentFolderId,
      isTrashView,
      selection,
      anchorKey,
      focusKey,
      setSelection,
      setFocusKey,
      clearSelection,
      activeDrag,
      dialogOpen: dialog !== null,
      requestNewFolder: (parentId) =>
        setDialog({ kind: "new-folder", parentId }),
      requestRename: (ref) => setDialog({ kind: "rename", ref }),
      requestMove: (refs) => {
        if (refs.length > 0) setDialog({ kind: "move", refs });
      },
      requestDeleteForever: (refs) => {
        if (refs.length > 0) setDialog({ kind: "delete-forever", refs });
      },
      requestEmptyTrash: () => setDialog({ kind: "empty-trash" }),
      createPresentationIn,
      trash,
      restore,
      move,
      duplicate,
      showToast,
    }),
    [
      currentFolderId,
      isTrashView,
      selection,
      anchorKey,
      focusKey,
      setSelection,
      clearSelection,
      activeDrag,
      dialog,
      createPresentationIn,
      trash,
      restore,
      move,
      duplicate,
      showToast,
    ],
  );

  return (
    <DriveContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        {children}
        <DragOverlay dropAnimation={null} modifiers={[followCursor]}>
          {activeDrag && <DragChip refs={activeDrag} />}
        </DragOverlay>
      </DndContext>

      {dialog?.kind === "new-folder" && (
        <NewFolderDialog
          parentId={dialog.parentId}
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            setDialog(null);
            if ((dialog.parentId ?? null) === currentFolderId) {
              setSelection([itemKey("folder", id)], itemKey("folder", id));
            }
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title={DRIVE_COPY.rename}
          initialValue={itemName(dialog.ref)}
          confirmLabel={COMMON_COPY.confirm}
          validate={(name) => {
            if (dialog.ref.kind === "folder") {
              return validateFolderName(
                name,
                parentOf(dialog.ref),
                dialog.ref.id,
              );
            }
            const trimmed = name.trim();
            if (!trimmed) return DRIVE_COPY.nameRequired;
            if (trimmed.length > 100) return DRIVE_COPY.nameTooLong(100);
            return null;
          }}
          onSubmit={(name) => {
            const result = renameItem(dialog.ref, name);
            setDialog(null);
            if (!result.ok) showToast(result.error);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          refs={dialog.refs}
          onCancel={() => setDialog(null)}
          onMove={(target) => {
            setDialog(null);
            clearSelection();
            move(dialog.refs, target);
          }}
        />
      )}
      {dialog?.kind === "delete-forever" && (
        <ConfirmDialog
          title={DRIVE_COPY.deleteForever}
          message={
            <div>
              <p>
                {DRIVE_COPY.deleteForeverDialog.message(
                  describeCount(dialog.refs),
                )}
                {dialog.refs.some((ref) => ref.kind === "folder") &&
                  DRIVE_COPY.deleteForeverDialog.folderNote}
              </p>
              <p className="mt-1">
                {DRIVE_COPY.deleteForeverDialog.irreversible}
              </p>
            </div>
          }
          confirmLabel={DRIVE_COPY.deleteForever}
          isPending={isDeleting}
          onConfirm={() => void runDeleteForever(dialog.refs)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "empty-trash" && (
        <ConfirmDialog
          title={DRIVE_COPY.emptyTrash}
          message={DRIVE_COPY.emptyTrashMessage}
          confirmLabel={DRIVE_COPY.emptyTrash}
          isPending={isDeleting}
          onConfirm={() =>
            void runDeleteForever(
              listTrash(getFolderIndex(), listPresentations()).map((item) => ({
                kind: item.kind,
                id: item.id,
              })),
            )
          }
          onCancel={() => setDialog(null)}
        />
      )}
    </DriveContext.Provider>
  );
}

function NewFolderDialog({
  parentId,
  onClose,
  onCreated,
}: {
  parentId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}): React.JSX.Element {
  const [initialValue] = useState(() => {
    const index = getFolderIndex();
    const siblings = (index.childrenOf.get(parentId) ?? [])
      .filter((folder) => !folder.trashedAt)
      .map((folder) => folder.name);
    return resolveUniqueName(DRIVE_COPY.newFolder, siblings);
  });

  return (
    <NameDialog
      title={DRIVE_COPY.newFolder}
      initialValue={initialValue}
      confirmLabel={DRIVE_COPY.create}
      validate={(name) => validateFolderName(name, parentId)}
      onSubmit={(name) => onCreated(createFolder(parentId, name).id)}
      onCancel={onClose}
    />
  );
}

function DragChip({
  refs,
}: {
  refs: readonly DriveItemRef[];
}): React.JSX.Element {
  const first = refs[0];
  const many = refs.length > 1;
  return (
    <div className="relative inline-block cursor-grabbing">
      {many && (
        <div className="absolute inset-0 translate-1 rounded-xl border bg-card shadow-sm" />
      )}
      <div className="relative flex w-60 items-center gap-2.5 rounded-xl border bg-popover px-3 py-2.5 text-sm font-medium text-popover-foreground shadow-xl">
        {first?.kind === "folder" ? (
          <FolderIcon className="size-5 shrink-0 fill-current text-muted-foreground" />
        ) : (
          <PresentationIcon className="size-5 shrink-0" />
        )}
        <span className="truncate">{first ? itemName(first) : ""}</span>
      </div>
      {many && (
        <Badge data-testid="drag-count" className="absolute -top-2 -right-2">
          {refs.length}
        </Badge>
      )}
    </div>
  );
}
