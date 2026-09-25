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
    <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0 space-y-2">
      {error && (
        <p role="alert" className="text-xs text-rose-600 text-right">
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
              className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
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
              className="px-3 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
            >
              신고
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            닫기
          </button>
          <button
            type="button"
            data-testid="song-picker-add-btn"
            disabled={addDisabled}
            onClick={onAdd}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
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
    <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-zinc-900 dark:text-white truncate">
            {title}
          </h3>
          {badge}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          {meta}
        </p>
      </div>
      <ExternalSearchLinks title={title} />
    </div>
  );
}

const MINE_BADGE = (
  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
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
    <div className="flex-1 flex flex-col min-h-0">
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
              className="px-3 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              정보 수정
            </button>
            <button
              type="button"
              data-testid="song-picker-delete-btn"
              onClick={onDelete}
              className="px-3 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
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
    <div className="flex-1 flex flex-col min-h-0">
      <PreviewHeader
        title={summary.title}
        badge={
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
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
