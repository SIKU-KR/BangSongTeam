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
    <div className="flex-1 flex flex-col p-6 overflow-y-auto space-y-4">
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
          새 찬양 가사 직접 입력
        </h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          가사를 입력하면 빈 줄(엔터 2번) 기준으로 슬라이드가 자동 분할됩니다.
          (슬라이드당 최대 4줄)
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
            곡 제목 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            data-testid="song-picker-create-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 시간을 뚫고"
            className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
            아티스트 (선택)
          </label>
          <input
            type="text"
            data-testid="song-picker-create-artist-input"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="예: WELOVE"
            className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {title.trim() && (
        <div className="pt-1">
          <ExternalSearchLinks title={title} />
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-[220px]">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            가사 원문 붙여넣기 <span className="text-rose-500">*</span>
          </label>
          {previewSlides.length > 0 && (
            <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
              {previewSlides.length}개 슬라이드로 자동 분할됨
            </span>
          )}
        </div>
        <textarea
          data-testid="song-picker-create-lyrics-input"
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="당신은 시간을 뚫고&#10;이 땅 가운데 오셨네&#10;&#10;우리 없는 하늘을 원치 않아&#10;우리 삶에 오셨네"
          className="flex-1 w-full p-4 text-xs font-mono leading-relaxed bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
        />
      </div>

      <div className="pt-2 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <span>보관함에 저장하고 프레젠테이션에 추가</span>
        </button>
      </div>
    </div>
  );
}
