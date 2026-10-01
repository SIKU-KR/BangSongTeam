import React, { useState } from "react";
import { listPresentations } from "../presentation";
import {
  createFolder,
  getFolderIndex,
  suggestFolderName,
  validateFolderName,
} from "./folderStore";
import { useDrive } from "./driveContext";
import {
  deleteItemsForever,
  describeItems,
  DriveActionError,
  itemName,
  renameItem,
  validateItemName,
} from "./driveActions";
import { itemKey, listTrash, toItemRef, type DriveItemRef } from "./driveModel";
import { ConfirmDialog, MoveDialog, NameDialog } from "./DriveDialogs";
import { DRIVE_COPY } from "#copy/drive";
import { FOLDER_COPY } from "#copy/folders";
import { COMMON_COPY } from "#copy/common";

/** 드라이브에서 한 번에 하나만 열리는 대화 상자 */
export type DriveDialogState =
  | { kind: "new-folder"; parentId: string | null }
  | { kind: "rename"; ref: DriveItemRef }
  | { kind: "move"; refs: DriveItemRef[] }
  | { kind: "delete-forever"; refs: DriveItemRef[] }
  | { kind: "empty-trash" };

/**
 * 드라이브 대화 상자 자리.
 *
 * `DriveProvider` 안, 끌기 영역 밖에 둔다. 조작은 `useDrive()`로 컨텍스트의 것을 써서
 * 알림·선택이 목록과 같은 상태를 따른다. 영구 삭제가 끝날 때까지 버튼을 잠근다.
 */
export function DriveDialogHost({
  dialog,
  onClose,
}: {
  dialog: DriveDialogState | null;
  onClose: () => void;
}): React.JSX.Element {
  const drive = useDrive();
  const [isDeleting, setIsDeleting] = useState(false);

  const runDeleteForever = async (refs: DriveItemRef[]): Promise<void> => {
    if (refs.length === 0) {
      onClose();
      return;
    }
    const label = describeItems(refs);
    setIsDeleting(true);
    try {
      await deleteItemsForever(refs);
      drive.clearSelection();
      onClose();
      drive.showToast(
        refs.length === 1
          ? DRIVE_COPY.toast.deletedForever(label)
          : DRIVE_COPY.toast.deletedForeverMany(refs.length),
      );
    } catch (err) {
      onClose();
      drive.showToast(
        err instanceof DriveActionError
          ? err.message
          : DRIVE_COPY.toast.deleteForeverFailed,
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {dialog?.kind === "new-folder" && (
        <NewFolderDialog
          parentId={dialog.parentId}
          onClose={onClose}
          onCreated={(id) => {
            onClose();
            if ((dialog.parentId ?? null) === drive.currentFolderId) {
              drive.setSelection(
                [itemKey("folder", id)],
                itemKey("folder", id),
              );
            }
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title={DRIVE_COPY.rename}
          initialValue={itemName(dialog.ref)}
          confirmLabel={COMMON_COPY.confirm}
          validate={(name) => validateItemName(dialog.ref, name)}
          onSubmit={(name) => {
            const result = renameItem(dialog.ref, name);
            onClose();
            if (!result.ok) drive.showToast(result.error);
          }}
          onCancel={onClose}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          refs={dialog.refs}
          onCancel={onClose}
          onMove={(target) => {
            onClose();
            drive.clearSelection();
            drive.move(dialog.refs, target);
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
                  describeItems(dialog.refs),
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
          onCancel={onClose}
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
              listTrash(getFolderIndex(), listPresentations()).map(toItemRef),
            )
          }
          onCancel={onClose}
        />
      )}
    </>
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
  const [initialValue] = useState(() => suggestFolderName(parentId));

  return (
    <NameDialog
      title={FOLDER_COPY.newFolder}
      initialValue={initialValue}
      confirmLabel={DRIVE_COPY.create}
      validate={(name) => validateFolderName(name, parentId)}
      onSubmit={(name) => onCreated(createFolder(parentId, name).id)}
      onCancel={onClose}
    />
  );
}
