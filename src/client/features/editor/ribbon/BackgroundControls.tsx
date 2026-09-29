import React, { useId, useState } from "react";
import { ContrastIcon } from "lucide-react";
import { Button } from "#components/ui/button";
import { Slider } from "#components/ui/slider";
import { DEFAULT_BACKGROUND_COLOR, type DeckStyle } from "#shared";
import { useBackground } from "../../backgrounds/backgroundCatalog";
import type { BackgroundChoice } from "../../presentation/presentationStore";
import { BackgroundPickerModal } from "../BackgroundPickerModal";
import { RibbonDropdown } from "./RibbonDropdown";
import { RibbonGroup, RibbonTooltip } from "./RibbonPrimitives";
import { EDITOR_COPY } from "#copy/editor";
import { BACKGROUND_COPY } from "#copy/backgrounds";

export interface BackgroundControlsProps {
  style: DeckStyle;
  backgroundId: string | null | undefined;
  disabled: boolean;
  onUpdateStyle: (update: Partial<DeckStyle>, coalesceField?: string) => void;
  onUpdateBackground: (choice: BackgroundChoice) => void;
}

/** 리본 '배경' 그룹: 곡 배경(단색·영상·이미지) 선택과 검정 오버레이(어둡게) */
export function BackgroundControls({
  style,
  backgroundId,
  disabled,
  onUpdateStyle,
  onUpdateBackground,
}: BackgroundControlsProps): React.JSX.Element {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const background = useBackground(backgroundId);
  const overlayLabelId = useId();

  return (
    <RibbonGroup label={EDITOR_COPY.ribbon.background}>
      <RibbonTooltip
        content={
          background
            ? EDITOR_COPY.ribbon.backgroundTooltip(background.title)
            : BACKGROUND_COPY.picker.title
        }
      >
        <Button
          variant="ghost"
          size="sm"
          data-testid="open-bg-picker-btn"
          aria-label={EDITOR_COPY.ribbon.changeBackground}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setIsPickerOpen(true)}
        >
          <span
            className="h-6 w-10 shrink-0 overflow-hidden rounded-sm border"
            style={{
              backgroundColor: background
                ? DEFAULT_BACKGROUND_COLOR
                : (style.backgroundColor ?? DEFAULT_BACKGROUND_COLOR),
            }}
          >
            {background && (
              <img
                src={background.posterUrl}
                alt=""
                decoding="async"
                className="size-full object-cover"
              />
            )}
          </span>
          {EDITOR_COPY.ribbon.background}
        </Button>
      </RibbonTooltip>

      <RibbonDropdown
        label={EDITOR_COPY.ribbon.dim}
        text={EDITOR_COPY.ribbon.dim}
        testId="overlay-btn"
        disabled={disabled}
        panelClassName="w-60"
        icon={<ContrastIcon />}
      >
        {() => (
          <>
            <div className="flex items-center justify-between">
              <span id={overlayLabelId} className="font-semibold">
                {EDITOR_COPY.ribbon.overlayOpacity}
              </span>
              <span className="font-mono">{style.overlayOpacity}%</span>
            </div>
            <Slider
              aria-labelledby={overlayLabelId}
              min={0}
              max={100}
              step={1}
              value={[style.overlayOpacity]}
              onValueChange={(value) =>
                onUpdateStyle(
                  { overlayOpacity: Array.isArray(value) ? value[0] : value },
                  "overlayOpacity",
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              {EDITOR_COPY.ribbon.overlayHint}
            </p>
          </>
        )}
      </RibbonDropdown>

      <BackgroundPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        selectedBackgroundId={background?.id ?? null}
        selectedColor={style.backgroundColor}
        onSelect={onUpdateBackground}
      />
    </RibbonGroup>
  );
}
