import React, { useEffect, useState } from "react";
import type { Folder, FolderIndex } from "#shared";
import { getFolderPath } from "#shared";
import { ChevronRightIcon, FolderIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { useFolderIndex } from "./folderStore";

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
}

/**
 * 이동 대화 상자의 폴더 트리 (휴지통에 있는 폴더는 보이지 않는다).
 * 하위 목록마다 왼쪽 여백을 더해 깊이를 보인다.
 */
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
          index={index}
          {...props}
        />
      ))}
    </ul>
  );
}

function FolderTreeNode({
  folder,
  index,
  selectedId,
  onSelect,
  expanded,
  onToggle,
  isDisabled,
}: FolderTreeProps & {
  folder: Folder;
  index: FolderIndex<Folder>;
}): React.JSX.Element {
  const children = visibleChildren(index, folder.id);
  const isExpanded = expanded.has(folder.id);
  const isSelected = selectedId === folder.id;
  const disabled = isDisabled?.(folder.id) ?? false;

  return (
    <li
      role="treeitem"
      aria-expanded={children.length > 0 ? isExpanded : undefined}
      aria-selected={isSelected}
    >
      <div
        data-testid={`picker-node-${folder.id}`}
        className={cn(
          "flex w-full items-center gap-1 rounded-md pr-2 pl-1.5 transition-colors",
          isSelected
            ? "bg-accent font-semibold text-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          disabled && "opacity-40",
        )}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          aria-label={
            isExpanded ? `${folder.name} 접기` : `${folder.name} 펼치기`
          }
          onClick={() => onToggle(folder.id)}
          className={cn(children.length === 0 && "invisible")}
        >
          <ChevronRightIcon
            className={cn(
              "transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(folder.id)}
          className="min-w-0 flex-1 justify-start px-1 text-inherit hover:bg-transparent hover:text-inherit"
        >
          <FolderIcon
            className={cn(
              "fill-current",
              isSelected ? "text-foreground" : "text-muted-foreground",
            )}
          />
          <span className="truncate">{folder.name}</span>
        </Button>
      </div>
      {isExpanded && children.length > 0 && (
        <ul role="group" className="mt-0.5 space-y-0.5 pl-3.5">
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
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
