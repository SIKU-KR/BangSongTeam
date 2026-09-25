import React, { useState } from "react";
import type { Deck, PublicDeckSummary } from "#shared";
import { ExternalSearchLinks } from "../ExternalSearchLinks";
import { LyricsViewer } from "./LyricsViewer";
import { LibraryShareControls } from "../../sharing/LibraryShareControls";
import { usePublicDeck } from "../../../lib/api/catalogQueries";
import { describeApiError } from "../../../lib/api/request";

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
      await navigator.clipboard.writeText(copyText ?? "");
    } catch (error) {
      void error;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="shrink-0 space-y-2 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {error && (
        <p role="alert" className="text-right text-xs text-rose-600">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {copyText !== undefined && (
            <button
              type="button"
              data-testid="song-picker-copy-lyrics-btn"
              onClick={copy}
              className="cursor-pointer rounded-xl border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {copied ? "가사 복사됨 ✓" : "가사 텍스트 복사"}
            </button>
          )}
          {extraActions}
          {onReport && (
            <button
              type="button"
              data-testid="song-picker-report-btn"
              onClick={onReport}
              className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
            >
              신고
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
          <button
            type="button"
            data-testid="song-picker-add-btn"
            disabled={addDisabled}
            onClick={onAdd}
            className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {addLabel}
          </button>
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
    <div className="flex shrink-0 flex-col justify-between gap-3 border-b border-zinc-200 bg-white p-5 sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-bold text-zinc-900 dark:text-white">
            {title}
          </h3>
          {badge}
        </div>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {meta}
        </p>
      </div>
      <ExternalSearchLinks title={title} />
    </div>
  );
}

const MINE_BADGE = (
  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
    내 보관함
  </span>
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
            {`${deck.artist || "아티스트 미상"} · 총 ${deck.slides.length}개 슬라이드`}
            {deck.forkedFromAuthorName &&
              ` · 원작: ${deck.forkedFromAuthorName}`}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-5 font-mono text-xs">
        <LyricsViewer lyrics={deck.lyricsRaw} />
      </div>
      <LibraryShareControls deck={deck} />
      <ActionBar
        copyText={deck.lyricsRaw}
        addLabel="이 곡을 프레젠테이션에 추가"
        onAdd={onAdd}
        onClose={onClose}
        extraActions={
          <>
            <button
              type="button"
              data-testid="song-picker-edit-info-btn"
              onClick={onEditInfo}
              className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              정보 수정
            </button>
            <button
              type="button"
              data-testid="song-picker-delete-btn"
              onClick={onDelete}
              className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
            >
              삭제
            </button>
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
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            공유 찬양
          </span>
        }
        meta={
          <>
            {`${summary.artist || "아티스트 미상"} · 총 ${summary.slideCount}개 슬라이드 · 공유: ${summary.authorName} · ${summary.forkCount}회 가져감`}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-5 font-mono text-xs">
        {detail.data ? (
          <LyricsViewer lyrics={detail.data.lyricsRaw} />
        ) : detail.isError ? (
          <p className="text-xs text-rose-600">
            {describeApiError(detail.error)}
          </p>
        ) : (
          <p className="text-xs text-zinc-400">가사를 불러오는 중…</p>
        )}
      </div>
      <ActionBar
        copyText={detail.data?.lyricsRaw}
        addLabel={
          isAdding
            ? "가져오는 중…"
            : ownedCopy
              ? "보관함의 이 곡을 프레젠테이션에 추가"
              : "가져와서 프레젠테이션에 추가"
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
