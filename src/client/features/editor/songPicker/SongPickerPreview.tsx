import React, { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import type { Deck, PublicDeckSummary } from "#shared";
import { ExternalSearchLinks } from "../ExternalSearchLinks";
import { LyricsViewer } from "./LyricsViewer";
import { LibraryShareControls } from "../../sharing/LibraryShareControls";
import { usePublicDeck } from "../../../lib/api/catalogQueries";
import { describeApiError } from "../../../lib/api/request";
import { copyToClipboard } from "../../../lib/browser/clipboard";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

interface ActionBarProps {
  copyText?: string;
  addLabel: string;
  addDisabled?: boolean;
  onAdd: () => void;
  onClose: () => void;
  onReport?: () => void;
  extraActions?: React.ReactNode;
  error?: string | null;
}

function ActionBar({
  copyText,
  addLabel,
  addDisabled,
  onAdd,
  onClose,
  onReport,
  extraActions,
  error,
}: ActionBarProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await copyToClipboard(copyText ?? "");
    } catch (error) {
      void error;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="shrink-0 space-y-2 border-t bg-background p-4">
      {error && (
        <p role="alert" className="text-right text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {copyText !== undefined && (
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
          )}
          {extraActions}
          {onReport && (
            <Button
              variant="ghost"
              data-testid="song-picker-report-btn"
              onClick={onReport}
              className="text-muted-foreground hover:text-destructive"
            >
              {EDITOR_COPY.preview.report}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="ghost" onClick={onClose}>
            {COMMON_COPY.close}
          </Button>
          <Button
            data-testid="song-picker-add-btn"
            disabled={addDisabled}
            onClick={onAdd}
          >
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
      <ExternalSearchLinks title={title} />
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
      <div className="flex-1 overflow-y-auto p-5 font-mono text-xs">
        <LyricsViewer lyrics={deck.lyricsRaw} />
      </div>
      <LibraryShareControls deck={deck} />
      <ActionBar
        copyText={deck.lyricsRaw}
        addLabel={EDITOR_COPY.preview.addMine}
        onAdd={onAdd}
        onClose={onClose}
        extraActions={
          <>
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
          </>
        }
      />
    </div>
  );
}

/**
 * 공유 곡 미리보기.
 */
export function SharedDeckPreview({
  summary,
  ownedCopy,
  isAdding,
  error,
  onAdd,
  onClose,
  onReport,
}: {
  summary: PublicDeckSummary;
  ownedCopy?: Deck;
  isAdding: boolean;
  error: string | null;
  onAdd: () => void;
  onClose: () => void;
  onReport: () => void;
}): React.JSX.Element {
  const detail = usePublicDeck(summary.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PreviewHeader
        title={summary.title}
        badge={
          <Badge variant="outline">{EDITOR_COPY.preview.sharedBadge}</Badge>
        }
        meta={
          <>
            {EDITOR_COPY.preview.sharedMeta(
              summary.artist || EDITOR_COPY.song.unknownArtist,
              summary.slideCount,
              summary.authorName,
              summary.forkCount,
            )}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-5 font-mono text-xs">
        {detail.data ? (
          <LyricsViewer lyrics={detail.data.lyricsRaw} />
        ) : detail.isError ? (
          <p className="text-xs text-destructive">
            {describeApiError(detail.error)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {EDITOR_COPY.preview.loadingLyrics}
          </p>
        )}
      </div>
      <ActionBar
        copyText={detail.data?.lyricsRaw}
        addLabel={
          isAdding
            ? EDITOR_COPY.preview.importing
            : ownedCopy
              ? EDITOR_COPY.preview.addOwnedCopy
              : EDITOR_COPY.preview.importAndAdd
        }
        addDisabled={isAdding}
        onAdd={onAdd}
        onClose={onClose}
        onReport={onReport}
        error={error}
      />
    </div>
  );
}
