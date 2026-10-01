import React from "react";
import { cn } from "cn";
import { Badge } from "#components/ui/badge";
import type { PickerEntry } from "./pickerEntries";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

/**
 * 곡 선택 창 목록의 한 줄. 줄 안에 다른 버튼이 없어 행 전체를 버튼 역할로 두고,
 * Enter·Space는 행 자체에 포커스가 있을 때만 고른다.
 */
export function SongPickerEntryRow({
  entry,
  isSelected,
  onSelect,
}: {
  entry: PickerEntry;
  isSelected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const id = entry.kind === "mine" ? entry.deck.id : entry.summary.id;
  const title = entry.kind === "mine" ? entry.deck.title : entry.summary.title;
  const artist =
    entry.kind === "mine" ? entry.deck.artist : entry.summary.artist;
  const snippet =
    entry.kind === "mine"
      ? entry.deck.slides[0]?.lines.filter(Boolean).join(" ") ||
        entry.deck.lyricsRaw.split("\n").filter(Boolean)[0] ||
        ""
      : entry.summary.firstSlidePreview.join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      data-testid={`song-item-${id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-1 p-3.5 transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        isSelected
          ? "border-l-4 border-l-primary bg-accent pl-2.5"
          : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-bold">{title}</span>
        <div className="flex shrink-0 items-center gap-1">
          {entry.kind === "mine" && (
            <Badge variant="secondary">{EDITOR_COPY.song.myLibrary}</Badge>
          )}
          {entry.kind === "shared" && (
            <Badge variant="outline">
              {entry.ownedCopy
                ? EDITOR_COPY.picker.inLibrary
                : COMMON_COPY.share}
            </Badge>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {entry.kind === "mine"
              ? EDITOR_COPY.picker.slideCount(entry.deck.slides.length)
              : COMMON_COPY.forkCount(entry.summary.forkCount)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {artist || EDITOR_COPY.song.unknownArtist}
        </span>
        {entry.kind === "shared" && (
          <span className="shrink-0 truncate">{entry.summary.authorName}</span>
        )}
      </div>

      {snippet && (
        <p className="mt-0.5 truncate text-xs font-light text-muted-foreground">
          {snippet}
        </p>
      )}
    </div>
  );
}
