import React, { useEffect, useState } from "react";
import type { BackgroundMedia } from "#shared";
import { BackgroundPreview, useBackgroundCatalog } from "../backgrounds";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";

export interface BackgroundPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBackgroundId?: string | null;
  onSelect: (backgroundId: string | null) => void;
}

const ALL_TAGS = "전체";

function CheckBadge(): React.JSX.Element {
  return (
    <div className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
      <svg
        className="size-3.5"
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
      <div className="flex w-full flex-col gap-1 p-2.5">
        <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-200">
          {background.title}
        </span>
        {background.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {background.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
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
 * 곡 배경 선택 창. 배경 갤러리에서 태그로 걸러 고르거나 배경을 뺀다.
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
  const [activeTag, setActiveTag] = useState<string>(ALL_TAGS);

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const all = catalog.backgrounds;
  const tags = [...new Set(all.flatMap((bg) => bg.tags))];
  const visible =
    activeTag === ALL_TAGS
      ? all
      : all.filter((bg) => bg.tags.includes(activeTag));

  const pick = (backgroundId: string | null): void => {
    onSelect(backgroundId);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="background-picker-title"
      className="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/80 p-4 backdrop-blur-sm duration-200 fade-in"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h2 id="background-picker-title" className="text-lg font-bold">
              곡 배경 선택
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
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
            className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <svg
              className="size-5"
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

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800/80 dark:bg-zinc-950/40">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {[ALL_TAGS, ...tags].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={activeTag === tag}
                  onClick={() => setActiveTag(tag)}
                  className={`shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${
                    activeTag === tag
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-200/80 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800/70 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-6 sm:grid-cols-3 md:grid-cols-4">
          <button
            type="button"
            data-testid="bg-item-none"
            aria-pressed={!selectedBackgroundId}
            onClick={() => pick(null)}
            className={tileClassName(!selectedBackgroundId)}
          >
            <div className="relative flex aspect-video w-full items-center justify-center bg-black text-xs text-zinc-400">
              검은 화면
              {!selectedBackgroundId && <CheckBadge />}
            </div>
            <div className="w-full p-2.5">
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

          {all.length === 0 && (
            <div className="col-span-full py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              <p>아직 등록된 배경이 없습니다.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-6 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
          <span>
            {catalog.status === "offline"
              ? "오프라인: 저장해 둔 배경 목록입니다"
              : "고른 배경은 편집·송출 중에 이 기기에 저장되어 오프라인에서도 재생됩니다"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-zinc-200 px-4 py-1.5 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
