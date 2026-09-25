import React, { useEffect, useState } from "react";
import type { Folder, FolderIndex } from "#shared";
import { getFolderPath } from "#shared";
import { useFolderIndex } from "./folderStore";
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

/** 펼침 상태. 선택된 폴더의 조상은 자동으로 펼친다. */
export function useTreeExpansion(selectedId: string | null | undefined): {
  expanded: Set<string>;
  toggle: (id: string) => void;
} {
  const index = useFolderIndex();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!selectedId) return;
    const ancestors = getFolderPath(index, selectedId)
      .slice(0, -1)
      .map((folder) => folder.id);
    setExpanded((prev) => {
      if (ancestors.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ancestors) next.add(id);
      return next;
    });
  }, [index, selectedId]);

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return { expanded, toggle };
}

export interface FolderTreeProps {
  selectedId: string | null | undefined;
  onSelect: (folderId: string) => void;
  expanded: Set<string>;
  onToggle: (folderId: string) => void;
  isDisabled?: (folderId: string) => boolean;
  baseDepth?: number;
}

/** 이동 대화 상자의 폴더 트리 (휴지통에 있는 폴더는 보이지 않는다) */
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

  const stateClass = isSelected
    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 font-semibold"
    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900/60";

  return (
    <li
      role="treeitem"
      aria-expanded={children.length > 0 ? isExpanded : undefined}
      aria-selected={isSelected}
    >
      <div
        data-testid={`picker-node-${folder.id}`}
        className={`group flex w-full items-center gap-1 rounded-lg pr-2 transition-colors ${stateClass} ${
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
          className={`flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ${
            children.length === 0 ? "invisible" : ""
          }`}
        >
          <Icon
            name="chevronRight"
            className={`size-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
            strokeWidth={2.5}
          />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(folder.id)}
          title={folder.name}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 text-left text-xs disabled:cursor-not-allowed"
        >
          <FolderGlyph
            className={`size-4 shrink-0 ${
              isSelected
                ? "text-emerald-500 dark:text-emerald-400"
                : "text-zinc-400 dark:text-zinc-500"
            }`}
          />
          <span className="truncate">{folder.name}</span>
        </button>
      </div>
      {isExpanded && children.length > 0 && (
        <ul role="group" className="mt-0.5 space-y-0.5">
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              index={index}
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
