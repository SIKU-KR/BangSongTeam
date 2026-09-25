import React, { useState, useMemo, useEffect } from "react";
import {
  createId,
  Deck,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  Slide,
  splitLyricsIntoSlides,
} from "#shared";
import { ExternalSearchLinks } from "./ExternalSearchLinks";
import { getCurrentUserId } from "../../lib/auth";

export interface QuickLyricPasteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToSet: (deck: Deck) => void;
  initialTitle?: string;
  initialArtist?: string;
  initialLyrics?: string;
  renderSearchLinks?: (title: string) => React.ReactNode;
}

/** 빠른 가사 붙여넣기로 새 곡을 세트에 추가하는 모달. */
export function QuickLyricPasteModal({
  isOpen,
  onClose,
  onAddToSet,
  initialTitle = "",
  initialArtist = "",
  initialLyrics = "",
  renderSearchLinks,
}: QuickLyricPasteModalProps): React.JSX.Element | null {
  const [title, setTitle] = useState(initialTitle);
  const [artist, setArtist] = useState(initialArtist);
  const [lyricsRaw, setLyricsRaw] = useState(initialLyrics);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setArtist(initialArtist);
      setLyricsRaw(initialLyrics);
    }
  }, [isOpen, initialTitle, initialArtist, initialLyrics]);

  const slides: Slide[] = useMemo(() => {
    if (!lyricsRaw.trim()) return [];
    return splitLyricsIntoSlides(lyricsRaw);
  }, [lyricsRaw]);

  const isValid = title.trim().length > 0 && slides.length > 0;

  if (!isOpen) return null;

  const handleAdd = (): void => {
    if (!isValid) return;

    const userId = getCurrentUserId();
    if (!userId) return;

    const now = new Date().toISOString();
    const newDeck = DeckSchema.parse({
      id: createId(),
      userId,
      scope: "presentation",
      presentationId: null,
      title: title.trim(),
      artist: artist.trim(),
      lyricsRaw,
      slides,
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    onAddToSet(newDeck);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/75 p-4 backdrop-blur-sm duration-200 fade-in"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50/80 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <div>
            <h2
              id="modal-title"
              className="text-lg font-bold text-zinc-900 dark:text-white"
            >
              빠른 가사 붙여넣기
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              가사를 붙여넣으면 빈 줄 기준으로 슬라이드가 자동 분할됩니다. 빈
              줄이 없으면 2줄씩 자동 분할됩니다. (슬라이드당 최대 4줄)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="song-title-input"
                className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              >
                곡 제목{" "}
                <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                id="song-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="곡 제목을 입력하세요 (예: 은혜로다)"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-white dark:placeholder-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="song-artist-input"
                className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              >
                아티스트 / 작곡가
              </label>
              <input
                id="song-artist-input"
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="아티스트 (선택사항, 예: 손경민)"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-white dark:placeholder-zinc-500"
              />
            </div>

            <div className="pt-1">
              {renderSearchLinks ? (
                renderSearchLinks(title)
              ) : (
                <ExternalSearchLinks title={title} />
              )}
            </div>

            <div className="flex min-h-[220px] flex-1 flex-col">
              <label
                htmlFor="song-lyrics-textarea"
                className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              >
                가사 원문{" "}
                <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <textarea
                id="song-lyrics-textarea"
                value={lyricsRaw}
                onChange={(e) => setLyricsRaw(e.target.value)}
                placeholder="가사를 여기에 붙여넣으세요...&#10;&#10;빈 줄로 슬라이드를 나눌 수 있으며, 4줄을 초과하면 2줄씩 자동 분할됩니다."
                className="min-h-[220px] w-full flex-1 resize-none rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm/relaxed text-zinc-900 placeholder-zinc-400 transition-all focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-100 dark:placeholder-zinc-500"
              />
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
            <div className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
              <span className="text-xs font-semibold tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                슬라이드 분할 미리보기
              </span>
              <span className="rounded-sm bg-zinc-200 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                총 {slides.length}장
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {slides.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  <span className="mb-2 text-2xl">📄</span>
                  왼쪽 영역에 가사를 붙여넣으면
                  <br />
                  실시간으로 슬라이드가 분할되어 표시됩니다.
                </div>
              ) : (
                slides.map((slide) => (
                  <div
                    key={slide.id || slide.order}
                    data-testid="slide-preview-card"
                    className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-700/60 dark:bg-zinc-800/60 dark:shadow-none dark:hover:border-zinc-600"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        슬라이드 {slide.order + 1}
                      </span>
                      <span className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        {slide.lines.length}줄
                      </span>
                    </div>
                    <div className="space-y-1 font-sans text-xs text-zinc-800 dark:text-zinc-200">
                      {slide.lines.map((line, idx) => (
                        <div key={idx} className="truncate">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-zinc-200 bg-zinc-50/80 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:border-transparent dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!isValid}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          >
            세트에 추가
          </button>
        </div>
      </div>
    </div>
  );
}
