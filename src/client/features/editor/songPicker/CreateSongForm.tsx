import React, { useMemo, useState } from "react";
import { splitLyricsIntoSlides } from "#shared";
import { ExternalSearchLinks } from "../ExternalSearchLinks";

export interface CreateSongValues {
  title: string;
  artist: string;
  lyricsRaw: string;
}

export interface CreateSongFormProps {
  initialTitle?: string;
  onCancel: () => void;
  onSubmit: (values: CreateSongValues) => void;
}

/**
 * 새 찬양 가사 직접 입력 폼.
 */
export function CreateSongForm({
  initialTitle = "",
  onCancel,
  onSubmit,
}: CreateSongFormProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle);
  const [artist, setArtist] = useState("");
  const [lyrics, setLyrics] = useState("");

  const previewSlides = useMemo(
    () => (lyrics.trim() ? splitLyricsIntoSlides(lyrics) : []),
    [lyrics],
  );
  const isValid = title.trim().length > 0 && previewSlides.length > 0;

  return (
    <div className="flex flex-1 flex-col space-y-4 overflow-y-auto p-6">
      <div className="border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
          새 찬양 가사 직접 입력
        </h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          가사를 입력하면 빈 줄(엔터 2번) 기준으로 슬라이드가 자동 분할됩니다.
          빈 줄이 없으면 2줄씩 자동 분할됩니다. (슬라이드당 최대 4줄)
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            곡 제목 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            data-testid="song-picker-create-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 시간을 뚫고"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            아티스트 (선택)
          </label>
          <input
            type="text"
            data-testid="song-picker-create-artist-input"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="예: WELOVE"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </div>
      </div>

      {title.trim() && (
        <div className="pt-1">
          <ExternalSearchLinks title={title} />
        </div>
      )}

      <div className="flex min-h-[220px] flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            가사 원문 붙여넣기 <span className="text-rose-500">*</span>
          </label>
          {previewSlides.length > 0 && (
            <span className="font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {previewSlides.length}개 슬라이드로 자동 분할됨
            </span>
          )}
        </div>
        <textarea
          data-testid="song-picker-create-lyrics-input"
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="당신은 시간을 뚫고&#10;이 땅 가운데 오셨네&#10;&#10;우리 없는 하늘을 원치 않아&#10;우리 삶에 오셨네"
          className="w-full flex-1 resize-none rounded-xl border border-zinc-300 bg-white p-4 font-mono text-xs/relaxed text-zinc-900 placeholder-zinc-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-xl px-4 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          data-testid="song-picker-create-submit-btn"
          disabled={!isValid}
          onClick={() =>
            onSubmit({
              title: title.trim(),
              artist: artist.trim(),
              lyricsRaw: lyrics,
            })
          }
          className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span>보관함에 저장하고 프레젠테이션에 추가</span>
        </button>
      </div>
    </div>
  );
}
