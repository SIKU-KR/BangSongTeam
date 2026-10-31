import React from "react";
import { cn } from "cn";
import { Badge } from "#components/ui/badge";
import type { Deck } from "#shared";
import { EDITOR_COPY } from "#copy/editor";

/**
 * 곡 선택 창 목록의 한 줄. 줄 안에 다른 버튼이 없어 행 전체를 버튼 역할로 두고,
 * Enter·Space는 행 자체에 포커스가 있을 때만 고른다.
 */
export function SongPickerEntryRow({
  deck,
  isSelected,
  onSelect,
}: {
  deck: Deck;
  isSelected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const snippet =
    deck.slides[0]?.lines.filter(Boolean).join(" ") ||
    deck.lyricsRaw.split("\n").filter(Boolean)[0] ||
    "";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      data-testid={`song-item-${deck.id}`}
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
        <span className="truncate text-xs font-bold">{deck.title}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary">{EDITOR_COPY.song.myLibrary}</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {EDITOR_COPY.picker.slideCount(deck.slides.length)}
          </span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="truncate">
          {deck.artist || EDITOR_COPY.song.unknownArtist}
        </span>
      </div>

      {snippet && (
        <p className="mt-0.5 truncate text-xs font-light text-muted-foreground">
          {snippet}
        </p>
      )}
    </div>
  );
}
