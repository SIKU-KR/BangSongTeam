import React, { useEffect, useState } from "react";
import type { Folder, FolderIndex } from "@repo/shared";
import { getFolderPath } from "@repo/shared";
import { useFolderIndex } from "./folderStore";
import { useDriveDroppable } from "./driveContext";
import { FolderGlyph, Icon } from "./icons";

const collator = new Intl.Collator("ko", { numeric: true });

function visibleChildren(
  index: FolderIndex<Folder>,
  parentId: string | null,
): Folder[] {
  return (index.childrenOf.get(parentId) ?? [])
    .filter((folder) => !folder.trashedAt)
    .sort((a, b) => collator.compare(a.name, b.name));
}

const EXPANDED_STORAGE_KEY = "drive.tree.expanded";

function loadExpanded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<string>): void {
  try {
    window.localStorage.setItem(
      EXPANDED_STORAGE_KEY,
      JSON.stringify([...expanded]),
    );
  } catch (error) {
    void error;
  }
}

/**
 * 펼침 상태. 선택된 폴더의 조상은 자동으로 펼친다.
 * 사이드바는 브라우저에 기억하고, 이동 대화 상자는 그때만 쓴다.
 */
export function useTreeExpansion(
  selectedId: string | null | undefined,
  persist: boolean,
): { expanded: Set<string>; toggle: (id: string) => void } {
  const index = useFolderIndex();
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    persist ? loadExpanded() : new Set(),
  );

  useEffect(() => {
    if (!selectedId) return;
    const ancestors = getFolderPath(index, selectedId)
      .slice(0, -1)
      .map((folder) => folder.id);
    setExpanded((prev) => {
      if (ancestors.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ancestors) next.add(id);
      if (persist) saveExpanded(next);
      return next;
    });
  }, [index, selectedId, persist]);

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (persist) saveExpanded(next);
      return next;
    });
  };

  return { expanded, toggle };
}

export interface FolderTreeProps {
  mode: "nav" | "picker";
  selectedId: string | null | undefined;
  onSelect: (folderId: string) => void;
  expanded: Set<string>;
  onToggle: (folderId: string) => void;
  isDisabled?: (folderId: string) => boolean;
  baseDepth?: number;
}

/** 폴더 트리 (휴지통에 있는 폴더는 보이지 않는다) */
export function FolderTree(props: FolderTreeProps): React.JSX.Element | null {
  const index = useFolderIndex();
  const roots = visibleChildren(index, null);
  if (roots.length === 0) return null;
  return (
    <ul role="group" className="space-y-0.5">
      {roots.map((folder) => (
        <FolderTreeNode
          key={folder.id}
          folder={folder}
          depth={props.baseDepth ?? 0}
          index={index}
          {...props}
        />
      ))}
    </ul>
  );
}

function FolderTreeNode({
  folder,
  depth,
  index,
  mode,
  selectedId,
  onSelect,
  expanded,
  onToggle,
  isDisabled,
}: FolderTreeProps & {
  folder: Folder;
  depth: number;
  index: FolderIndex<Folder>;
}): React.JSX.Element {
  const children = visibleChildren(index, folder.id);
  const isExpanded = expanded.has(folder.id);
  const isSelected = selectedId === folder.id;
  const disabled = isDisabled?.(folder.id) ?? false;
  const { setNodeRef, isDropTarget } = useDriveDroppable(
    `tree:${folder.id}`,
    { kind: "folder", folderId: folder.id },
    mode !== "nav",
  );

  const stateClass = isDropTarget
    ? "ring-2 ring-emerald-500/70 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
    : isSelected
      ? mode === "nav"
        ? "bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-white font-semibold"
        : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 font-semibold"
      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900/60";

  return (
    <li
      role="treeitem"
      aria-expanded={children.length > 0 ? isExpanded : undefined}
      aria-selected={isSelected}
    >
      <div
        ref={setNodeRef}
        data-testid={`${mode === "nav" ? "tree" : "picker"}-node-${folder.id}`}
        className={`group w-full rounded-lg flex items-center gap-1 pr-2 transition-colors ${stateClass} ${
          disabled ? "opacity-40" : ""
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={
            isExpanded ? `${folder.name} 접기` : `${folder.name} 펼치기`
          }
          onClick={() => onToggle(folder.id)}
          className={`w-5 h-5 shrink-0 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer ${
            children.length === 0 ? "invisible" : ""
          }`}
        >
          <Icon
            name="chevronRight"
            className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
            strokeWidth={2.5}
          />
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-current={mode === "nav" && isSelected ? "page" : undefined}
          onClick={() => onSelect(folder.id)}
          title={folder.name}
          className="flex-1 min-w-0 py-1.5 flex items-center gap-2 text-left text-xs cursor-pointer disabled:cursor-not-allowed"
        >
          <FolderGlyph
            className={`w-4 h-4 shrink-0 ${
              isSelected
                ? "text-emerald-500 dark:text-emerald-400"
                : "text-zinc-400 dark:text-zinc-500"
            }`}
          />
          <span className="truncate">{folder.name}</span>
        </button>
      </div>
      {isExpanded && children.length > 0 && (
        <ul role="group" className="space-y-0.5 mt-0.5">
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              index={index}
              mode={mode}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
              isDisabled={isDisabled}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
