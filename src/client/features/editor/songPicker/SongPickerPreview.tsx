import React, { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import type { Deck } from "#shared";
import { LyricsViewer } from "./LyricsViewer";
import { copyToClipboard } from "../../../lib/browser/clipboard";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

const COPIED_FEEDBACK_MS = 2000;

function CopyLyricsButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await copyToClipboard(text);
    } catch (error) {
      void error;
    }
    setCopied(true);
  };

  return (
    <Button
      variant="outline"
      data-testid="song-picker-copy-lyrics-btn"
      onClick={copy}
    >
      {copied ? (
        <>
          {EDITOR_COPY.preview.lyricsCopied} <CheckIcon />
        </>
      ) : (
        EDITOR_COPY.preview.copyLyrics
      )}
    </Button>
  );
}

interface ActionBarProps {
  addLabel: string;
  onAdd: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}

function ActionBar({
  addLabel,
  onAdd,
  onClose,
  children,
}: ActionBarProps): React.JSX.Element {
  return (
    <div className="shrink-0 space-y-2 border-t bg-background p-4">
      <div
        data-testid="song-picker-actions"
        className="flex items-center justify-between gap-2 max-md:flex-wrap"
      >
        <div className="flex items-center gap-2">{children}</div>

        <div className="flex items-center gap-2.5 max-md:ml-auto">
          <Button variant="ghost" onClick={onClose}>
            {COMMON_COPY.close}
          </Button>
          <Button data-testid="song-picker-add-btn" onClick={onAdd}>
            {addLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewHeader({
  title,
  badge,
  meta,
}: {
  title: string;
  badge: React.ReactNode;
  meta: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 flex-col justify-between gap-3 border-b bg-background p-5 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-bold">{title}</h3>
          {badge}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
      </div>
    </div>
  );
}

const MINE_BADGE = (
  <Badge variant="secondary">{EDITOR_COPY.song.myLibrary}</Badge>
);

/**
 * 내 보관함 곡 미리보기.
 */
export function MyDeckPreview({
  deck,
  onAdd,
  onClose,
  onEditInfo,
  onDelete,
}: {
  deck: Deck;
  onAdd: () => void;
  onClose: () => void;
  onEditInfo: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PreviewHeader
        title={deck.title}
        badge={MINE_BADGE}
        meta={
          <>
            {EDITOR_COPY.preview.mineMeta(
              deck.artist || EDITOR_COPY.song.unknownArtist,
              deck.slides.length,
            )}
            {deck.forkedFromAuthorName &&
              EDITOR_COPY.preview.forkedFrom(deck.forkedFromAuthorName)}
          </>
        }
      />
      <div
        data-testid="song-picker-lyrics"
        className="flex-1 overflow-y-auto p-5 font-mono text-xs max-md:max-h-64"
      >
        <LyricsViewer lyrics={deck.lyricsRaw} />
      </div>
      <ActionBar
        addLabel={EDITOR_COPY.preview.addMine}
        onAdd={onAdd}
        onClose={onClose}
      >
        <CopyLyricsButton text={deck.lyricsRaw} />
        <Button
          variant="ghost"
          data-testid="song-picker-edit-info-btn"
          onClick={onEditInfo}
        >
          {EDITOR_COPY.preview.editInfo}
        </Button>
        <Button
          variant="ghost"
          data-testid="song-picker-delete-btn"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          {COMMON_COPY.delete}
        </Button>
      </ActionBar>
    </div>
  );
}
