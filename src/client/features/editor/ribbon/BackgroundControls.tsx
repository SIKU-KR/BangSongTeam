import React, { useState } from "react";
import type { DeckStyle } from "#shared";
import { useBackground } from "../../backgrounds/backgroundCatalog";
import { BackgroundPickerModal } from "../BackgroundPickerModal";
import { RibbonDropdown } from "./RibbonDropdown";
import { RibbonGroup, RibbonIcon } from "./RibbonPrimitives";

export interface BackgroundControlsProps {
  style: DeckStyle;
  backgroundId: string | null | undefined;
  disabled: boolean;
  onUpdateStyle: (update: Partial<DeckStyle>, coalesceField?: string) => void;
  onUpdateBackground: (backgroundId: string | null) => void;
}

/** 리본 '배경' 그룹: 곡 배경 선택과 검정 오버레이(어둡게) */
export function BackgroundControls({
  style,
  backgroundId,
  disabled,
  onUpdateStyle,
  onUpdateBackground,
}: BackgroundControlsProps): React.JSX.Element {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const background = useBackground(backgroundId);

  return (
    <RibbonGroup label="배경">
      <button
        type="button"
        data-testid="open-bg-picker-btn"
        aria-label="곡 배경 바꾸기"
        title={background ? `곡 배경: ${background.title}` : "곡 배경 선택"}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsPickerOpen(true)}
        className="h-8 pl-1 pr-2 rounded-md flex items-center gap-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <span className="w-10 h-6 rounded overflow-hidden bg-zinc-900 border border-zinc-300 dark:border-zinc-700 shrink-0">
          {background && (
            <img
              src={background.posterUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
        </span>
        <span>배경</span>
      </button>

      <RibbonDropdown
        label="어둡게"
        text="어둡게"
        testId="overlay-btn"
        disabled={disabled}
        panelClassName="w-60"
        icon={<RibbonIcon d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 0v18" />}
      >
        {() => (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold">검정 오버레이</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                {style.overlayOpacity}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={style.overlayOpacity}
              onChange={(e) =>
                onUpdateStyle(
                  { overlayOpacity: Number(e.target.value) },
                  "overlayOpacity",
                )
              }
              aria-label="검정 오버레이 불투명도"
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              배경 위를 어둡게 덮어 가사를 잘 보이게 합니다.
            </p>
          </div>
        )}
      </RibbonDropdown>

      <BackgroundPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        selectedBackgroundId={background?.id ?? null}
        onSelect={onUpdateBackground}
      />
    </RibbonGroup>
  );
}
