import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BackgroundMedia, BackgroundSource } from "#shared";
import { BackgroundPreview, useBackgroundCatalog } from "../backgrounds";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";

export interface BackgroundPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBackgroundId?: string | null;
  onSelect: (backgroundId: string | null) => void;
}

const ALL_TAGS = "전체";

const TABS: { source: BackgroundSource; label: string }[] = [
  { source: "service", label: "기본 제공" },
  { source: "user", label: "내 배경" },
];

function CheckBadge(): React.JSX.Element {
  return (
    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg">
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
          d="M5 13l4 4L19 7"
        />
      </svg>
    </div>
  );
}

function tileClassName(isSelected: boolean): string {
  return `group relative flex flex-col rounded-xl overflow-hidden border text-left cursor-pointer transition-all ${
    isSelected
      ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/50 dark:bg-zinc-800"
      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-900/60 shadow-sm dark:shadow-none"
  }`;
}

function PickerTile({
  background,
  isSelected,
  onPick,
}: {
  background: BackgroundMedia;
  isSelected: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      data-testid={`bg-item-${background.id}`}
      aria-pressed={isSelected}
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={tileClassName(isSelected)}
    >
      <div className="relative w-full">
        <BackgroundPreview background={background} playing={hovered} />
        {isSelected && <CheckBadge />}
      </div>
      <div className="p-2.5 flex flex-col gap-1 w-full">
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">
          {background.title}
        </span>
        {background.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {background.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * 곡 배경 선택 창. 기본 제공 배경과 내가 올린 배경 중에서 고르거나 배경을 뺀다.
 * 고르는 즉시 편집 미리보기에 반영되고 창이 닫힌다.
 */
export function BackgroundPickerModal(
  props: BackgroundPickerModalProps,
): React.JSX.Element | null {
  return props.isOpen ? <PickerDialog {...props} /> : null;
}

function PickerDialog({
  onClose,
  selectedBackgroundId,
  onSelect,
}: BackgroundPickerModalProps): React.JSX.Element {
  const catalog = useBackgroundCatalog();
  const [tab, setTab] = useState<BackgroundSource>(
    () =>
      catalog.backgrounds.find((bg) => bg.id === selectedBackgroundId)
        ?.source ?? "service",
  );
  const [activeTag, setActiveTag] = useState<string>(ALL_TAGS);

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const inTab = catalog.backgrounds.filter((bg) => bg.source === tab);
  const tags = [...new Set(inTab.flatMap((bg) => bg.tags))];
  const visible =
    activeTag === ALL_TAGS
      ? inTab
      : inTab.filter((bg) => bg.tags.includes(activeTag));

  const pick = (backgroundId: string | null): void => {
    onSelect(backgroundId);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="background-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl dark:shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 id="background-picker-title" className="text-lg font-bold">
              곡 배경 선택
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              한 곡의 모든 슬라이드가 같은 배경을 씁니다. 영상은 슬라이드가
              넘어가도 끊기지 않고 이어집니다.
            </p>
          </div>
          <button
            type="button"
            data-testid="close-bg-modal-btn"
            onClick={onClose}
            title="닫기"
            aria-label="닫기"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950/40 flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            className="flex rounded-lg bg-zinc-200/70 dark:bg-zinc-800 p-0.5"
          >
            {TABS.map(({ source, label }) => (
              <button
                key={source}
                type="button"
                role="tab"
                aria-selected={tab === source}
                onClick={() => {
                  setTab(source);
                  setActiveTag(ALL_TAGS);
                }}
                className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  tab === source
                    ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {[ALL_TAGS, ...tags].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={activeTag === tag}
                  onClick={() => setActiveTag(tag)}
                  className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 cursor-pointer ${
                    activeTag === tag
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-200/80 dark:bg-zinc-800/70 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 content-start">
          <button
            type="button"
            data-testid="bg-item-none"
            aria-pressed={!selectedBackgroundId}
            onClick={() => pick(null)}
            className={tileClassName(!selectedBackgroundId)}
          >
            <div className="relative aspect-video w-full bg-black flex items-center justify-center text-xs text-zinc-400">
              검은 화면
              {!selectedBackgroundId && <CheckBadge />}
            </div>
            <div className="p-2.5 w-full">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                배경 없음
              </span>
            </div>
          </button>

          {visible.map((bg) => (
            <PickerTile
              key={bg.id}
              background={bg}
              isSelected={bg.id === selectedBackgroundId}
              onPick={() => pick(bg.id)}
            />
          ))}

          {inTab.length === 0 && (
            <div className="col-span-full py-8 text-center text-xs text-zinc-500 dark:text-zinc-400 space-y-2">
              {tab === "service" ? (
                <p>아직 제공되는 기본 배경이 없습니다.</p>
              ) : (
                <>
                  <p>아직 올린 배경이 없습니다.</p>
                  <Link
                    to="/backgrounds"
                    className="inline-block text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                  >
                    배경 라이브러리에서 올리기
                  </Link>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {catalog.status === "offline"
              ? "오프라인: 저장해 둔 배경 목록입니다"
              : "고른 배경은 편집·송출 중에 이 기기에 저장되어 오프라인에서도 재생됩니다"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
