import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Deck } from "#shared";
import { useIsOnline } from "../../hooks/useIsOnline";
import { describeApiError } from "../../lib/api/request";
import { PublishDialog } from "./PublishDialog";
import { ReportDialog } from "./ReportDialog";
import { publishLibraryDeck, unpublishLibraryDeck } from "./publishSong";

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
      className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 shrink-0 space-y-1.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="song-share-status" className="text-xs">
          {isTakenDown ? (
            <span className="text-rose-600">
              게시 중단됨 — 운영자가 공개를 내렸습니다
            </span>
          ) : isPublic ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              공유 라이브러리에 공개 중 · {deck.forkCount}회 가져감
            </span>
          ) : (
            <span className="text-zinc-500">비공개 — 나만 볼 수 있습니다</span>
          )}
        </p>

        <div className="flex items-center gap-2">
          {correctionTargetId && (
            <button
              type="button"
              data-testid="song-share-correction-btn"
              disabled={!isOnline}
              onClick={() => setIsReportOpen(true)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
            >
              원본에 교정 제안
            </button>
          )}
          {!isTakenDown &&
            (isPublic ? (
              <button
                type="button"
                data-testid="song-share-unpublish-btn"
                disabled={!isOnline || busy}
                onClick={() => unpublish.mutate()}
                className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-xs font-medium cursor-pointer"
              >
                {unpublish.isPending ? "전환 중…" : "비공개로 전환"}
              </button>
            ) : (
              <button
                type="button"
                data-testid="song-share-publish-btn"
                disabled={!isOnline || busy}
                onClick={() => {
                  publish.reset();
                  setIsPublishOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold cursor-pointer"
              >
                공유 라이브러리에 공개
              </button>
            ))}
        </div>
      </div>

      {!isOnline && (
        <p className="text-[11px] text-zinc-400">
          공유는 온라인에서만 할 수 있습니다.
        </p>
      )}
      {unpublish.error && (
        <p role="alert" className="text-[11px] text-rose-600">
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
