import React, { useId, useState } from "react";
import { ContrastIcon } from "lucide-react";
import { Button } from "#components/ui/button";
import { Slider } from "#components/ui/slider";
import type { DeckStyle } from "#shared";
import { useBackground } from "../../backgrounds/backgroundCatalog";
import { BackgroundPickerModal } from "../BackgroundPickerModal";
import { RibbonDropdown } from "./RibbonDropdown";
import { RibbonGroup, RibbonTooltip } from "./RibbonPrimitives";

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
  const overlayLabelId = useId();

  return (
    <RibbonGroup label="배경">
      <RibbonTooltip
        content={background ? `곡 배경: ${background.title}` : "곡 배경 선택"}
      >
        <Button
          variant="ghost"
          size="sm"
          data-testid="open-bg-picker-btn"
          aria-label="곡 배경 바꾸기"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setIsPickerOpen(true)}
        >
          <span className="h-6 w-10 shrink-0 overflow-hidden rounded-sm border bg-black">
            {background && (
              <img
                src={background.posterUrl}
                alt=""
                decoding="async"
                className="size-full object-cover"
              />
            )}
          </span>
          배경
        </Button>
      </RibbonTooltip>

      <RibbonDropdown
        label="어둡게"
        text="어둡게"
        testId="overlay-btn"
        disabled={disabled}
        panelClassName="w-60"
        icon={<ContrastIcon />}
      >
        {() => (
          <>
            <div className="flex items-center justify-between">
              <span id={overlayLabelId} className="font-semibold">
                검정 오버레이 불투명도
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
            <p className="text-2xs text-muted-foreground">
              배경 위를 어둡게 덮어 가사를 잘 보이게 합니다.
            </p>
          </>
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
