import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "#components/ui/button";
import type { Deck } from "#shared";
import { useIsOnline } from "../../hooks/useIsOnline";
import { describeApiError } from "../../lib/api/request";
import { PublishDialog } from "./PublishDialog";
import { ReportDialog } from "./ReportDialog";
import { publishLibraryDeck, unpublishLibraryDeck } from "./publishSong";
import { SHARING_COPY } from "#copy/sharing";

export interface LibraryShareControlsProps {
  deck: Deck;
}

/**
 * 내 보관함 곡의 공유 라이브러리 공개 설정. 곡 추가 창의 보관함 미리보기에서만
 * 쓴다. 공개 대상은 보관함 원본이며 세트 복제본의 수정은 반영하지 않는다.
 */
export function LibraryShareControls({
  deck,
}: LibraryShareControlsProps): React.JSX.Element {
  const isOnline = useIsOnline();
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);

  const publish = useMutation({
    mutationFn: () => publishLibraryDeck(deck.id),
    onSuccess: () => setIsPublishOpen(false),
  });
  const unpublish = useMutation({
    mutationFn: () => unpublishLibraryDeck(deck.id),
  });

  const isPublic = deck.visibility === "public";
  const isTakenDown = !!deck.takedownAt;
  const busy = publish.isPending || unpublish.isPending;
  const correctionTargetId =
    deck.origin === "fork" && deck.forkedFrom ? deck.forkedFrom : null;

  return (
    <section
      data-testid="library-share-controls"
      className="shrink-0 space-y-1.5 border-t bg-muted/40 px-5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="song-share-status" className="text-xs">
          {isTakenDown ? (
            <span className="text-destructive">
              {SHARING_COPY.library.takenDown}
            </span>
          ) : isPublic ? (
            <span className="font-medium">
              {SHARING_COPY.library.public(deck.forkCount)}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {SHARING_COPY.library.private}
            </span>
          )}
        </p>

        <div className="flex items-center gap-2">
          {correctionTargetId && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="song-share-correction-btn"
              disabled={!isOnline}
              onClick={() => setIsReportOpen(true)}
            >
              {SHARING_COPY.library.suggestCorrection}
            </Button>
          )}
          {!isTakenDown &&
            (isPublic ? (
              <Button
                variant="outline"
                size="sm"
                data-testid="song-share-unpublish-btn"
                disabled={!isOnline || busy}
                onClick={() => unpublish.mutate()}
              >
                {unpublish.isPending
                  ? SHARING_COPY.library.unpublishing
                  : SHARING_COPY.library.unpublish}
              </Button>
            ) : (
              <Button
                size="sm"
                data-testid="song-share-publish-btn"
                disabled={!isOnline || busy}
                onClick={() => {
                  publish.reset();
                  setIsPublishOpen(true);
                }}
              >
                {SHARING_COPY.library.publish}
              </Button>
            ))}
        </div>
      </div>

      {!isOnline && (
        <p className="text-2xs text-muted-foreground">
          {SHARING_COPY.library.onlineOnly}
        </p>
      )}
      {unpublish.error && (
        <p role="alert" className="text-2xs text-destructive">
          {describeApiError(unpublish.error)}
        </p>
      )}

      <PublishDialog
        key={isPublishOpen ? "open" : "closed"}
        isOpen={isPublishOpen}
        songTitle={deck.title}
        isPending={publish.isPending}
        error={publish.error ? describeApiError(publish.error) : null}
        onConfirm={() => publish.mutate()}
        onCancel={() => setIsPublishOpen(false)}
      />

      {correctionTargetId && isReportOpen && (
        <ReportDialog
          isOpen
          onClose={() => setIsReportOpen(false)}
          targetType="deck"
          targetId={correctionTargetId}
          targetTitle={deck.title}
          defaultReason="correction"
        />
      )}
    </section>
  );
}
