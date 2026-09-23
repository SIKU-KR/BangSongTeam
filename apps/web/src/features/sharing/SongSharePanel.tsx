import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Deck } from "@repo/shared";
import { useLibraryDeck } from "../editor/songLibraryStore";
import { useIsOnline } from "../../hooks/useIsOnline";
import { describeApiError } from "../../lib/api/request";
import { PublishDialog } from "./PublishDialog";
import { ReportDialog } from "./ReportDialog";
import {
  hasUnpublishedChanges,
  publishSong,
  unpublishSong,
  updatePublishedSong,
} from "./publishSong";

export interface SongSharePanelProps {
  songIndex: number;
  song: Deck;
}

/**
 * 편집기 속성 패널의 '공유' 섹션 (PRD 5장 덱 공유 설정).
 *
 * 공유 단위는 곡의 보관함 원본이다. 이 세트의 곡 내용을 원본에 반영해 공개하고,
 * 공개 상태·가져간 횟수·원작자를 보여 준다. 서버에 닿아야 하는 동작이라
 * 오프라인에서는 버튼을 막는다.
 */
export function SongSharePanel({
  songIndex,
  song,
}: SongSharePanelProps): React.JSX.Element {
  const isOnline = useIsOnline();
  const master = useLibraryDeck(song.forkedFrom);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);

  const publish = useMutation({
    mutationFn: () => publishSong(songIndex),
    onSuccess: () => setIsPublishOpen(false),
  });
  const update = useMutation({
    mutationFn: () => updatePublishedSong(songIndex),
  });
  const unpublish = useMutation({
    mutationFn: (id: string) => unpublishSong(id),
  });

  const isPublic = master?.visibility === "public";
  const isTakenDown = !!master?.takedownAt;
  const hasChanges = !!master && hasUnpublishedChanges(song, master);
  const busy = publish.isPending || update.isPending || unpublish.isPending;
  const error = update.error ?? unpublish.error;

  // 교정 제안을 받을 원본: 포크본이면 가져온 공개 덱
  const correctionTargetId =
    master?.origin === "fork" && master.forkedFrom ? master.forkedFrom : null;
  const authorName = master?.forkedFromAuthorName ?? song.forkedFromAuthorName;

  return (
    <section
      data-testid="song-share-panel"
      className="space-y-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-900"
    >
      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
        공유
      </label>

      <p data-testid="song-share-status" className="text-xs">
        {isTakenDown ? (
          <span className="text-rose-600">
            게시 중단됨 — 운영자가 공개를 내렸습니다
          </span>
        ) : isPublic ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            공개 중 · {master?.forkCount ?? 0}회 가져감
          </span>
        ) : (
          <span className="text-zinc-500">비공개 — 나만 볼 수 있습니다</span>
        )}
      </p>

      {authorName && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span
            data-testid="song-share-attribution"
            className="text-zinc-500 truncate"
          >
            원작: {authorName}
          </span>
          {correctionTargetId && (
            <button
              type="button"
              data-testid="song-share-correction-btn"
              disabled={!isOnline}
              onClick={() => setIsReportOpen(true)}
              className="text-[11px] text-zinc-500 hover:text-rose-600 disabled:opacity-40 cursor-pointer shrink-0"
            >
              원본에 교정 제안
            </button>
          )}
        </div>
      )}

      {!isTakenDown && (
        <div className="flex flex-wrap gap-2">
          {!isPublic ? (
            <button
              type="button"
              data-testid="song-share-publish-btn"
              disabled={!isOnline || busy}
              onClick={() => {
                publish.reset();
                setIsPublishOpen(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer"
            >
              공유 라이브러리에 공개
            </button>
          ) : (
            <>
              {hasChanges && (
                <button
                  type="button"
                  data-testid="song-share-update-btn"
                  disabled={!isOnline || busy}
                  onClick={() => update.mutate()}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                >
                  {update.isPending ? "반영 중…" : "공개본 업데이트"}
                </button>
              )}
              <button
                type="button"
                data-testid="song-share-unpublish-btn"
                disabled={!isOnline || busy || !master}
                onClick={() => master && unpublish.mutate(master.id)}
                className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-xs font-medium cursor-pointer"
              >
                {unpublish.isPending ? "전환 중…" : "비공개로 전환"}
              </button>
            </>
          )}
        </div>
      )}

      {isPublic && hasChanges && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          이 세트에서 고친 내용이 공개본에 아직 반영되지 않았습니다.
        </p>
      )}
      {!isOnline && (
        <p className="text-[11px] text-zinc-400">
          공유는 온라인에서만 할 수 있습니다.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-rose-600">
          {describeApiError(error)}
        </p>
      )}

      <PublishDialog
        key={isPublishOpen ? "open" : "closed"}
        isOpen={isPublishOpen}
        songTitle={song.title}
        overwritesLibraryCopy={!!master}
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
          targetTitle={song.title}
          defaultReason="correction"
        />
      )}
    </section>
  );
}
