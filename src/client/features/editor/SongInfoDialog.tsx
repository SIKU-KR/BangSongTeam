import React, { useEffect, useRef, useState } from "react";

const MAX_FIELD_LENGTH = 100;

export interface SongInfoValues {
  title: string;
  artist: string;
}

export interface SongInfoDialogProps {
  heading: string;
  initialValues: SongInfoValues;
  notice?: React.ReactNode;
  onSubmit: (values: SongInfoValues) => void;
  onCancel: () => void;
}

/**
 * 곡 제목·아티스트 수정 대화 상자. 세트 곡과 보관함 곡이 함께 쓴다.
 * 길이 제한은 `DeckSchema`의 title·artist 최대 100자와 맞춘다.
 */
export function SongInfoDialog({
  heading,
  initialValues,
  notice,
  onSubmit,
  onCancel,
}: SongInfoDialogProps): React.JSX.Element {
  const [title, setTitle] = useState(initialValues.title);
  const [artist, setArtist] = useState(initialValues.artist);
  const titleRef = useRef<HTMLInputElement>(null);
  const isValid = title.trim().length > 0;

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="song-info-dialog-title"
      data-testid="song-info-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-5 space-y-4 text-zinc-900 dark:text-zinc-100"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isValid) return;
          onSubmit({ title: title.trim(), artist: artist.trim() });
        }}
      >
        <h2 id="song-info-dialog-title" className="text-sm font-bold">
          {heading}
        </h2>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              곡 제목 <span className="text-rose-500">*</span>
            </span>
            <input
              ref={titleRef}
              type="text"
              data-testid="song-info-title-input"
              value={title}
              maxLength={MAX_FIELD_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              아티스트 (선택)
            </span>
            <input
              type="text"
              data-testid="song-info-artist-input"
              value={artist}
              maxLength={MAX_FIELD_LENGTH}
              onChange={(event) => setArtist(event.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none text-sm"
            />
          </label>
        </div>

        {notice && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {notice}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            취소
          </button>
          <button
            type="submit"
            data-testid="song-info-save-btn"
            disabled={!isValid}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
