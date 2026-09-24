import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
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
  DEFAULT_FOLDER_NAME,
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
  ROOT_LABEL,
  withDirectionParticle,
  withObjectParticle,
  type DriveItemRef,
} from "./driveModel";
import { ConfirmDialog, MoveDialog, NameDialog } from "./DriveDialogs";
import { listPresentations } from "../presentation";
import { resolveUniqueName } from "@repo/shared";
import { FolderGlyph, Icon } from "./icons";

type DialogState =
  | { kind: "new-folder"; parentId: string | null }
  | { kind: "rename"; ref: DriveItemRef }
  | { kind: "move"; refs: DriveItemRef[] }
  | { kind: "delete-forever"; refs: DriveItemRef[] }
  | { kind: "empty-trash" }
  | null;

interface ToastState {
  id: number;
  message: string;
  action?: ToastAction;
}

const TOAST_DURATION_MS = 6000;

/**
 * 드래그 칩을 포인터 오른쪽 아래에 붙인다.
 *
 * DragOverlay는 기본적으로 끌기 시작한 카드의 왼쪽 위에 놓인다. 카드는 크고 칩은
 * 작아서, 사이드바 트리처럼 멀리 끌면 칩이 포인터와 떨어져 화면 밖으로 나간다.
 */
const followCursor: Modifier = ({ activatorEvent, activeNodeRect, transform }) => {
  const origin = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  if (!origin || !activeNodeRect) return transform;
  return {
    ...transform,
    x: transform.x + origin.x - activeNodeRect.left + 12,
    y: transform.y + origin.y - activeNodeRect.top + 12,
  };
};
const NEW_PRESENTATION_TITLE = "새 주일 예배 프레젠테이션";

function describeCount(refs: readonly DriveItemRef[]): string {
  return refs.length === 1 ? `‘${itemName(refs[0])}’` : `${refs.length}개 항목`;
}

/**
 * 드라이브 상태 공급자 (홈 셸 전체를 감싼다).
 *
 * 사이드바 폴더 트리, 헤더 브레드크럼, 본문 그리드가 같은 선택·드래그 상태를
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
  const [activeDrag, setActiveDrag] = useState<DriveItemRef[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastSeq = useRef(0);

  // 다른 폴더로 가면 선택을 비운다 (보이지 않는 항목이 선택된 채 남지 않게)
  useEffect(() => {
    setSelectionState(new Set());
    setAnchorKey(null);
  }, [pathname]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const setSelection = useCallback(
    (keys: readonly string[], anchor?: string | null): void => {
      setSelectionState(new Set(keys));
      if (anchor !== undefined) setAnchorKey(anchor);
    },
    [],
  );
  const clearSelection = useCallback((): void => {
    setSelectionState(new Set());
    setAnchorKey(null);
  }, []);

  const showToast = useCallback(
    (message: string, action?: ToastAction): void => {
      toastSeq.current += 1;
      setToast({ id: toastSeq.current, message, action });
    },
    [],
  );

  const trash = useCallback(
    (refs: DriveItemRef[]): void => {
      if (refs.length === 0) return;
      const label = describeCount(refs);
      const trashed = trashItems(refs);
      clearSelection();
      showToast(`${withObjectParticle(label)} 휴지통으로 이동했습니다`, {
        label: "실행취소",
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
      showToast(`${withObjectParticle(label)} 복원했습니다`);
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
          ? ROOT_LABEL
          : itemName({ kind: "folder", id: targetFolderId });
      showToast(
        `${withObjectParticle(label)} ${withDirectionParticle(`‘${targetName}’`)} 옮겼습니다`,
        {
          label: "실행취소",
          run: () => undoMove(outcome),
        },
      );
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
          ? `${withObjectParticle(`‘${copies[0].title}’`)} 만들었습니다`
          : `사본 ${copies.length}개를 만들었습니다`,
      );
    },
    [setSelection, showToast],
  );

  const createPresentationIn = useCallback(
    (folderId: string | null): void => {
      const target = isFolderAvailable(folderId) ? folderId : null;
      const created = createNewPresentation(NEW_PRESENTATION_TITLE, target);
      navigate(`/editor/${created.id}`);
    },
    [navigate],
  );

  const runDeleteForever = async (refs: DriveItemRef[]): Promise<void> => {
    setIsDeleting(true);
    try {
      await deleteItemsForever(refs);
      clearSelection();
      setDialog(null);
      showToast(
        refs.length === 1
          ? `${withObjectParticle(describeCount(refs))} 영구 삭제했습니다`
          : `${refs.length}개 항목을 영구 삭제했습니다`,
      );
    } catch (err) {
      setDialog(null);
      showToast(
        err instanceof DriveActionError
          ? err.message
          : "영구 삭제하지 못했습니다",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 드래그 앤 드롭
  // ---------------------------------------------------------------------------

  // 5px 넘게 움직여야 드래그로 본다. 그래야 클릭(선택)·더블클릭(열기)이 산다.
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
      setSelection,
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
          title="이름 바꾸기"
          initialValue={itemName(dialog.ref)}
          confirmLabel="확인"
          validate={(name) => {
            if (dialog.ref.kind === "folder") {
              return validateFolderName(
                name,
                parentOf(dialog.ref),
                dialog.ref.id,
              );
            }
            const trimmed = name.trim();
            if (!trimmed) return "이름을 입력하세요";
            if (trimmed.length > 100) return "이름은 100자까지 쓸 수 있습니다";
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
          title="영구 삭제"
          message={
            <>
              {withObjectParticle(describeCount(dialog.refs))} 영구 삭제합니다.
              {dialog.refs.some((ref) => ref.kind === "folder") &&
                " 폴더 안의 모든 항목도 함께 삭제됩니다."}{" "}
              이 작업은 되돌릴 수 없습니다.
            </>
          }
          confirmLabel="영구 삭제"
          isPending={isDeleting}
          onConfirm={() => void runDeleteForever(dialog.refs)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "empty-trash" && (
        <ConfirmDialog
          title="휴지통 비우기"
          message="휴지통의 모든 항목이 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
          confirmLabel="휴지통 비우기"
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

      {toast && (
        <DriveToast
          key={toast.id}
          toast={toast}
          onClose={() => setToast(null)}
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
  // 같은 위치에 '새 폴더'가 있으면 번호를 붙인 이름을 미리 채운다
  const [initialValue] = useState(() => {
    const index = getFolderIndex();
    const siblings = (index.childrenOf.get(parentId) ?? [])
      .filter((folder) => !folder.trashedAt)
      .map((folder) => folder.name);
    return resolveUniqueName(DEFAULT_FOLDER_NAME, siblings);
  });

  return (
    <NameDialog
      title="새 폴더"
      initialValue={initialValue}
      confirmLabel="만들기"
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
  const single = refs.length === 1 ? refs[0] : null;
  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-emerald-400 dark:border-emerald-600 shadow-xl text-xs font-semibold text-zinc-800 dark:text-zinc-100 cursor-grabbing">
      {single?.kind === "folder" ? (
        <FolderGlyph className="w-4 h-4 text-emerald-500" />
      ) : (
        <Icon name="slides" className="w-4 h-4 text-emerald-500" />
      )}
      <span className="max-w-[220px] truncate">
        {single ? itemName(single) : `${refs.length}개 항목`}
      </span>
    </div>
  );
}

function DriveToast({
  toast,
  onClose,
}: {
  toast: ToastState;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div
      role="status"
      data-testid="drive-toast"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 lg:left-[calc(50%+8rem)] z-[70] flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-2xl text-xs max-w-[90vw]"
    >
      <span className="truncate">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          data-testid="drive-toast-action"
          onClick={() => {
            toast.action?.run();
            onClose();
          }}
          className="px-2 py-1 rounded-lg font-semibold text-emerald-300 dark:text-emerald-700 hover:bg-white/10 dark:hover:bg-black/10 cursor-pointer"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="알림 닫기"
        onClick={onClose}
        className="p-1 rounded-lg hover:bg-white/10 dark:hover:bg-black/10 cursor-pointer"
      >
        <Icon name="close" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
