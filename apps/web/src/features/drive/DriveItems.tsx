import React from "react";
import type { Presentation } from "@repo/shared";
import { DEFAULT_DECK_STYLE, getBackgroundPosterUrl } from "@repo/shared";
import { SlideStage } from "../../components/stage/SlideStage";
import { useDriveDraggable, useDriveDroppable } from "./driveContext";
import {
  buildSubtitle,
  formatDate,
  formatEditedAgo,
  type DriveFileItem,
  type DriveFolderItem,
  type DriveItem,
} from "./driveModel";
import { FolderGlyph, Icon } from "./icons";

export interface DriveItemHandlers {
  selected: boolean;
  interactive: boolean;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPresent?: () => void;
  onEdit?: () => void;
}

function useItemDnd(
  item: DriveItem,
  interactive: boolean,
): {
  ref: (node: HTMLElement | null) => void;
  listeners: ReturnType<typeof useDriveDraggable>["listeners"];
  isDragging: boolean;
  isDropTarget: boolean;
} {
  const drag = useDriveDraggable(item.key, !interactive);
  const drop = useDriveDroppable(
    `item:${item.key}`,
    { kind: "folder", folderId: item.kind === "folder" ? item.id : null },
    !interactive || item.kind !== "folder",
  );
  return {
    ref: (node) => {
      drag.setNodeRef(node);
      drop.setNodeRef(node);
    },
    listeners: interactive ? drag.listeners : undefined,
    isDragging: drag.isDragging,
    isDropTarget: drop.isDropTarget,
  };
}

const CARD_BASE =
  "group relative flex flex-col bg-white dark:bg-zinc-900/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/90 border rounded-2xl overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-lg dark:hover:shadow-black/50 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

function cardStateClass(
  selected: boolean,
  isDropTarget: boolean,
  isDragging: boolean,
): string {
  if (isDropTarget) {
    return "border-emerald-500 ring-2 ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 -translate-y-0.5";
  }
  const base = selected
    ? "border-emerald-500 dark:border-emerald-500 ring-2 ring-emerald-500/70 bg-emerald-50/70 dark:bg-emerald-950/20"
    : "border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 hover:-translate-y-0.5";
  return `${base} ${isDragging ? "opacity-40" : ""}`;
}

function MoreButton({
  label,
  onMore,
}: {
  label: string;
  onMore: DriveItemHandlers["onMore"];
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="item-more-btn"
      aria-label={`${label} 더보기`}
      onClick={(event) => {
        event.stopPropagation();
        onMore(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className="p-1 -mr-1 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer shrink-0"
    >
      <Icon name="dots" className="w-4 h-4" />
    </button>
  );
}

/**
 * 프레젠테이션 16:9 썸네일 (첫 곡 첫 슬라이드를 실제 스테이지로 축소 렌더).
 *
 * 배경은 포스터 이미지만 쓴다. 카드마다 루프 영상을 틀면 폴더 하나에 수십 개의
 * 영상이 동시에 재생된다.
 */
export function PresentationThumbnail({
  presentation,
  children,
}: {
  presentation: Presentation;
  children?: React.ReactNode;
}): React.JSX.Element {
  const leadDeck = presentation.items[0]?.deck;
  const rawLeadSlide = leadDeck?.slides[0] ?? null;
  const leadSlide = rawLeadSlide
    ? { ...rawLeadSlide, lines: rawLeadSlide.lines.map((l) => `${l}\u200B`) }
    : null;
  const totalSlides = presentation.items.reduce(
    (sum, item) => sum + (item.deck?.slides.length ?? 0),
    0,
  );

  return (
    <div className="relative w-full aspect-video bg-black overflow-hidden rounded-t-2xl">
      <div className="w-full h-full pointer-events-none transition-transform duration-300 group-hover:scale-[1.02]">
        <SlideStage
          slide={leadSlide}
          style={leadDeck?.style ?? DEFAULT_DECK_STYLE}
          posterUrl={getBackgroundPosterUrl(leadDeck?.backgroundId)}
          staticBackground
        />
      </div>

      <div className="absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5 pointer-events-none">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 backdrop-blur-md text-emerald-400 border border-emerald-500/30">
          16:9
        </span>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-950/80 backdrop-blur-md text-indigo-300 border border-indigo-700/40">
          {presentation.items.length}곡 세트
        </span>
      </div>
      <div className="absolute top-2.5 right-2.5 z-30 pointer-events-none">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-black/70 backdrop-blur-md text-zinc-300 border border-zinc-700/40">
          {totalSlides} 슬라이드
        </span>
      </div>
      {children}
    </div>
  );
}

export function FolderCard({
  item,
  handlers,
}: {
  item: DriveFolderItem;
  handlers: DriveItemHandlers;
}): React.JSX.Element {
  const dnd = useItemDnd(item, handlers.interactive);
  return (
    <div
      ref={dnd.ref}
      {...dnd.listeners}
      role="option"
      aria-selected={handlers.selected}
      aria-label={`폴더 ${item.name}`}
      tabIndex={0}
      data-testid="folder-card"
      data-item-key={item.key}
      onClick={handlers.onClick}
      onDoubleClick={handlers.onDoubleClick}
      onContextMenu={handlers.onContextMenu}
      className={`${CARD_BASE} ${cardStateClass(handlers.selected, dnd.isDropTarget, dnd.isDragging)}`}
    >
      <div className="relative w-full aspect-video overflow-hidden rounded-t-2xl bg-gradient-to-br from-emerald-50 via-zinc-50 to-teal-50/70 dark:from-emerald-950/40 dark:via-zinc-900 dark:to-zinc-950 flex items-center justify-center">
        <FolderGlyph className="w-16 h-16 text-emerald-500/85 dark:text-emerald-400/70 drop-shadow-sm transition-transform duration-300 group-hover:scale-105" />
        <div className="absolute top-2.5 left-2.5 pointer-events-none">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/80 dark:bg-black/60 backdrop-blur-md text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
            폴더
          </span>
        </div>
        <div className="absolute top-2.5 right-2.5 pointer-events-none">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/80 dark:bg-black/60 backdrop-blur-md text-zinc-600 dark:text-zinc-300 border border-zinc-300/60 dark:border-zinc-700/40">
            항목 {item.childCount}개
          </span>
        </div>
      </div>

      <div className="p-3.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3
            className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate"
            title={item.name}
          >
            {item.name}
          </h3>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
            <FolderGlyph className="w-3.5 h-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
            <span className="truncate">
              {item.location ?? `항목 ${item.childCount}개`}
            </span>
            <span className="text-zinc-300 dark:text-zinc-600 shrink-0">•</span>
            <span className="shrink-0">{formatEditedAgo(item.updatedAt)}</span>
          </div>
        </div>
        <MoreButton label={item.name} onMore={handlers.onMore} />
      </div>
    </div>
  );
}

export function FileCard({
  item,
  handlers,
}: {
  item: DriveFileItem;
  handlers: DriveItemHandlers;
}): React.JSX.Element {
  const dnd = useItemDnd(item, handlers.interactive);
  const { presentation } = item;
  return (
    <div
      ref={dnd.ref}
      {...dnd.listeners}
      role="option"
      aria-selected={handlers.selected}
      aria-label={`프레젠테이션 ${item.name}`}
      tabIndex={0}
      data-testid="presentation-card"
      data-item-key={item.key}
      onClick={handlers.onClick}
      onDoubleClick={handlers.onDoubleClick}
      onContextMenu={handlers.onContextMenu}
      className={`${CARD_BASE} ${cardStateClass(handlers.selected, false, dnd.isDragging)}`}
    >
      <PresentationThumbnail presentation={presentation}>
        {handlers.onPresent && handlers.onEdit && (
          <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2.5 p-4">
            <button
              type="button"
              data-testid="card-present-btn"
              onClick={(event) => {
                event.stopPropagation();
                handlers.onPresent?.();
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md flex items-center gap-1.5 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
              title="전체화면 송출"
            >
              <Icon name="play" className="w-3.5 h-3.5" />
              <span>발표</span>
            </button>
            <button
              type="button"
              data-testid="card-edit-btn"
              onClick={(event) => {
                event.stopPropagation();
                handlers.onEdit?.();
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className="px-3.5 py-1.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 text-xs font-medium border border-zinc-600/50 shadow-md flex items-center gap-1.5 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
              title="편집기 열기"
            >
              <Icon name="pencil" className="w-3.5 h-3.5" />
              <span>편집</span>
            </button>
          </div>
        )}
      </PresentationThumbnail>

      <div className="p-3.5 flex items-start justify-between gap-2 bg-transparent">
        <div className="min-w-0 flex-1">
          <h3
            className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate"
            title={item.name}
          >
            {item.name}
          </h3>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
            <span className="w-4 h-4 rounded flex items-center justify-center bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800/80 text-[9px] font-bold shrink-0">
              W
            </span>
            <span className="truncate">
              {item.location ?? buildSubtitle(presentation)}
            </span>
            <span className="text-zinc-300 dark:text-zinc-600 shrink-0">•</span>
            <span className="shrink-0">{formatEditedAgo(item.updatedAt)}</span>
          </div>
        </div>
        <MoreButton label={item.name} onMore={handlers.onMore} />
      </div>
    </div>
  );
}

export function DriveListRow({
  item,
  handlers,
}: {
  item: DriveItem;
  handlers: DriveItemHandlers;
}): React.JSX.Element {
  const dnd = useItemDnd(item, handlers.interactive);
  const stateClass = dnd.isDropTarget
    ? "bg-emerald-50 dark:bg-emerald-950/40 outline outline-2 -outline-offset-2 outline-emerald-500"
    : handlers.selected
      ? "bg-emerald-50/80 dark:bg-emerald-950/30"
      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50";

  return (
    <tr
      ref={dnd.ref}
      {...dnd.listeners}
      aria-selected={handlers.selected}
      tabIndex={0}
      data-testid={item.kind === "folder" ? "folder-row" : "presentation-row"}
      data-item-key={item.key}
      onClick={handlers.onClick}
      onDoubleClick={handlers.onDoubleClick}
      onContextMenu={handlers.onContextMenu}
      className={`cursor-pointer select-none transition-colors outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800 ${stateClass} ${
        dnd.isDragging ? "opacity-40" : ""
      }`}
    >
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-3 min-w-0">
          {item.kind === "folder" ? (
            <div className="w-10 h-6 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-center shrink-0">
              <FolderGlyph className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            </div>
          ) : (
            <div className="w-10 h-6 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-[10px] text-zinc-600 dark:text-zinc-400 font-bold shrink-0">
              16:9
            </div>
          )}
          <div className="min-w-0">
            <span className="font-semibold text-zinc-900 dark:text-white truncate block">
              {item.name}
            </span>
            <span className="text-[11px] text-zinc-500 truncate block">
              {item.location ??
                (item.kind === "folder"
                  ? "폴더"
                  : buildSubtitle(item.presentation))}
            </span>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-4 hidden sm:table-cell text-zinc-500 dark:text-zinc-400">
        나
      </td>
      <td className="py-2.5 px-4 hidden md:table-cell text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
        {formatDate(item.updatedAt)}
      </td>
      <td className="py-2.5 px-4 whitespace-nowrap">
        <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
          {item.kind === "folder"
            ? `항목 ${item.childCount}개`
            : `${item.songCount}곡 · ${item.slideCount}슬라이드`}
        </span>
      </td>
      <td className="py-2.5 px-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {handlers.onPresent && (
            <button
              type="button"
              data-testid="row-present-btn"
              onClick={(event) => {
                event.stopPropagation();
                handlers.onPresent?.();
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold cursor-pointer transition-colors"
            >
              발표
            </button>
          )}
          <MoreButton label={item.name} onMore={handlers.onMore} />
        </div>
      </td>
    </tr>
  );
}
