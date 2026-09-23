import React, { useState, useMemo, useEffect } from "react";
import {
  Deck,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  Slide,
  splitLyricsIntoSlides,
} from "@repo/shared";
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

    // 로그인이 편집의 전제 조건이 된 뒤(2026-09-22)에도 게스트 uuid가 하드코딩으로
    // 남아 있었다. 곡의 주인은 항상 세션 사용자다. 세션이 없으면 임의의 uuid를
    // 만들어 넣지 않는다 — 사용자 데이터에 존재하지 않는 소유자가 박힌다.
    // 로그인 게이트 때문에 실제로는 닿지 않는 경로다.
    const userId = getCurrentUserId();
    if (!userId) return;

    const now = new Date().toISOString();
    const newDeck = DeckSchema.parse({
      id: crypto.randomUUID(),
      userId,
      catalogId: null,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative flex flex-col w-full max-w-4xl max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl dark:shadow-2xl text-zinc-900 dark:text-zinc-100 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80">
          <div>
            <h2
              id="modal-title"
              className="text-lg font-bold text-zinc-900 dark:text-white"
            >
              빠른 가사 붙여넣기
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              가사를 붙여넣으면 빈 줄 기준으로 슬라이드가 자동 분할됩니다. (최대
              4줄 제한)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 overflow-y-auto">
          {/* Left Column: Form Inputs */}
          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="song-title-input"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
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
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label
                htmlFor="song-artist-input"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
              >
                아티스트 / 작곡가
              </label>
              <input
                id="song-artist-input"
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="아티스트 (선택사항, 예: 손경민)"
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            {/* External Search Links Slot */}
            <div className="pt-1">
              {renderSearchLinks ? (
                renderSearchLinks(title)
              ) : (
                <ExternalSearchLinks title={title} />
              )}
            </div>

            <div className="flex-1 flex flex-col min-h-[220px]">
              <label
                htmlFor="song-lyrics-textarea"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
              >
                가사 원문{" "}
                <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <textarea
                id="song-lyrics-textarea"
                value={lyricsRaw}
                onChange={(e) => setLyricsRaw(e.target.value)}
                placeholder="가사를 여기에 붙여넣으세요...&#10;&#10;빈 줄로 슬라이드를 나눌 수 있으며, 4줄을 초과하면 2줄씩 자동 분할됩니다."
                className="w-full flex-1 min-h-[220px] p-3 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Right Column: Real-time Slide Cards Preview */}
          <div className="flex flex-col bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 overflow-hidden">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                슬라이드 분할 미리보기
              </span>
              <span className="text-xs px-2 py-0.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded font-mono">
                총 {slides.length}장
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {slides.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center text-zinc-400 dark:text-zinc-500 text-xs p-4">
                  <span className="text-2xl mb-2">📄</span>
                  왼쪽 영역에 가사를 붙여넣으면
                  <br />
                  실시간으로 슬라이드가 분할되어 표시됩니다.
                </div>
              ) : (
                slides.map((slide) => (
                  <div
                    key={slide.id || slide.order}
                    data-testid="slide-preview-card"
                    className="p-3 bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 rounded-lg hover:border-zinc-300 dark:hover:border-zinc-600 shadow-sm dark:shadow-none transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        슬라이드 {slide.order + 1}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                        {slide.lines.length}줄
                      </span>
                    </div>
                    <div className="text-xs text-zinc-800 dark:text-zinc-200 space-y-1 font-sans">
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

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-transparent rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!isValid}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-500 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
          >
            세트에 추가
          </button>
        </div>
      </div>
    </div>
  );
}
