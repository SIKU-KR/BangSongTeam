import { useEffect, useRef, useState } from "react";

export interface CollapsedSongs {
  collapsedIds: ReadonlySet<string>;
  toggle: (itemId: string) => void;
  collapseAll: (itemIds: readonly string[]) => void;
  expandAll: () => void;
  keepCollapsedOnActivate: (itemId: string) => void;
}

/**
 * 썸네일 창에서 접힌 곡 구역. 현재 곡이 바뀌면 그 곡이 접혀 있을 때 저절로 펼친다.
 *
 * 다른 곡 머리글을 누르면 그 곡을 고르면서 동시에 접기를 토글하므로, 펼쳐져 있던 곡은
 * 접히자마자 현재 곡이 되어 자동 펼치기에 다시 펼쳐진다. `keepCollapsedOnActivate`로
 * 그 곡을 기억해 두면 이번 한 번은 자동 펼치기를 건너뛰어 사용자가 접은 상태를 지킨다.
 */
export function useCollapsedSongs(
  activeItemId: string | undefined,
): CollapsedSongs {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const keepCollapsedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeItemId) return;
    if (keepCollapsedIdRef.current === activeItemId) {
      keepCollapsedIdRef.current = null;
      return;
    }
    setCollapsedIds((prev) => {
      if (!prev.has(activeItemId)) return prev;
      const next = new Set(prev);
      next.delete(activeItemId);
      return next;
    });
  }, [activeItemId]);

  const toggle = (itemId: string): void => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const keepCollapsedOnActivate = (itemId: string): void => {
    if (!collapsedIds.has(itemId)) keepCollapsedIdRef.current = itemId;
  };

  return {
    collapsedIds,
    toggle,
    collapseAll: (itemIds) => setCollapsedIds(new Set(itemIds)),
    expandAll: () => setCollapsedIds(new Set()),
    keepCollapsedOnActivate,
  };
}
