import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { useNavigate } from "#hooks/useNavigate";
import { FolderIcon, PresentationIcon } from "lucide-react";
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
import { createNewPresentation, editorPath } from "../presentation";
import { isFolderAvailable } from "./folderStore";
import {
  DriveContext,
  DriveSearchQueryContext,
  canDropOn,
  type DriveContextValue,
  type DropTarget,
} from "./driveContext";
import {
  describeItems,
  duplicateItems,
  itemName,
  moveItems,
  restoreItems,
  trashItems,
  undoMove,
} from "./driveActions";
import {
  DEFAULT_SORT_ORDER,
  itemKey,
  parseItemKey,
  type DriveItemRef,
  type DriveTypeFilter,
  type SortOrder,
} from "./driveModel";
import { TRASH_PATH, isDrivePath } from "./drivePaths";
import { DriveDialogHost, type DriveDialogState } from "./DriveDialogHost";
import { useUndoToast } from "./useUndoToast";
import { DRIVE_COPY } from "#copy/drive";
import { COMMON_COPY } from "#copy/common";

// useSensor는 옵션 객체가 바뀌면 센서를 새로 만들고, 그러면 끌기·놓기 내부 컨텍스트가 바뀌어 모든 행이
// 다시 그려진다. 검색어를 칠 때마다 이 공급자가 다시 그려지므로 옵션을 렌더 밖에 둔다.
// @dnd-kit/core@6.3.1 dist/core.esm.js (`useSensor`, `useCombineActivators`)
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

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

/**
 * 드라이브 상태 공급자 (홈 셸 전체를 감싼다).
 *
 * 사이드바, 헤더 브레드크럼, 본문 목록이 같은 선택·드래그 상태를
 * 봐야 하므로 셸 한 곳에 둔다. 대화 상자와 알림(실행 취소)도 여기서 띄운다.
 *
 * 끌어서 옮기거나 버린 뒤에는 선택을 푼다. 목록에서 사라진 항목이 선택에 남으면 다음 끌기에
 * 함께 딸려 간다.
 *
 * 헤더의 드라이브 검색어는 친 위치에 묶인다. 셸은 화면을 오가도 남아 있어서, 검색 결과에서 연
 * 폴더나 휴지통에까지 검색어가 따라가면 화면이 바뀐 것 같지 않다. 드라이브 안에서 위치가 바뀌면
 * 비우고, 배경 갤러리에 다녀온 뒤 같은 위치로 돌아오면 그대로 둔다. 주소가 그대로인 열기(검색
 * 결과에서 지금 폴더 열기, 루트에서 내 드라이브 누르기)는 여는 쪽이 검색어를 비운다.
 */
export function DriveProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const navigate = useNavigate();
  const pathname = usePathname();
  const currentFolderId = useParams<{ folderId?: string }>().folderId ?? null;
  const isTrashView = pathname === TRASH_PATH;

  const [selection, setSelectionState] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DriveItemRef[] | null>(null);
  const [dialog, setDialog] = useState<DriveDialogState | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchPath, setSearchPath] = useState<string>(pathname);
  const { showToast } = useUndoToast({ isSuspended: dialog !== null });

  if (isDrivePath(pathname) && searchPath !== pathname) {
    setSearchPath(pathname);
    setSearchQuery("");
  }

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

  const trash = useCallback(
    (refs: DriveItemRef[]): void => {
      if (refs.length === 0) return;
      const label = describeItems(refs);
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
      const label = describeItems(refs);
      restoreItems(refs);
      clearSelection();
      showToast(DRIVE_COPY.toast.restored(label));
    },
    [clearSelection, showToast],
  );

  const move = useCallback(
    (refs: DriveItemRef[], targetFolderId: string | null): void => {
      const label = describeItems(refs);
      const outcome = moveItems(refs, targetFolderId);
      const [firstError] = outcome.errors;
      if (firstError && outcome.moved.length === 0) {
        showToast(firstError);
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
      const [first] = copies;
      if (!first) return;
      setSelection(
        copies.map((copy) => itemKey("file", copy.id)),
        itemKey("file", first.id),
      );
      showToast(
        copies.length === 1
          ? DRIVE_COPY.toast.duplicated(first.title)
          : DRIVE_COPY.toast.duplicatedMany(copies.length),
      );
    },
    [setSelection, showToast],
  );

  const createPresentationIn = useCallback(
    (folderId: string | null): void => {
      const target = isFolderAvailable(folderId) ? folderId : null;
      const created = createNewPresentation(target);
      navigate(editorPath(created.id));
    },
    [navigate],
  );

  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

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
    if (target.kind === "trash") {
      trash(refs);
      return;
    }
    clearSelection();
    move(refs, target.folderId);
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
      sortOrder,
      setSortOrder,
      typeFilter,
      setTypeFilter,
      setSearchQuery,
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
      sortOrder,
      typeFilter,
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
      <DriveSearchQueryContext.Provider value={searchQuery}>
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
      </DriveSearchQueryContext.Provider>

      <DriveDialogHost dialog={dialog} onClose={() => setDialog(null)} />
    </DriveContext.Provider>
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
