import React, { useId, useState } from "react";
import { ContrastIcon, HighlighterIcon } from "lucide-react";
import { Button } from "#components/ui/button";
import { Slider } from "#components/ui/slider";
import { Switch } from "#components/ui/switch";
import {
  resolveBackdropColor,
  type DeckStyle,
  type TextBackdrop,
} from "#shared";
import { useBackground } from "../../backgrounds/backgroundCatalog";
import type { BackgroundChoice } from "../../presentation/presentationStore";
import { BackgroundPickerModal } from "../BackgroundPickerModal";
import { RibbonDropdown } from "./RibbonDropdown";
import { RibbonGroup, RibbonTooltip } from "./RibbonPrimitives";
import { EDITOR_COPY } from "#copy/editor";
import { BACKGROUND_COPY } from "#copy/backgrounds";

interface BackgroundControlsProps {
  style: DeckStyle;
  backgroundId: string | null | undefined;
  disabled: boolean;
  onUpdateStyle: (update: Partial<DeckStyle>, coalesceField?: string) => void;
  onUpdateBackground: (choice: BackgroundChoice) => void;
}

/**
 * 리본 '배경' 그룹: 곡 배경(단색·영상·이미지) 선택, 화면 전체를 덮는 검정 오버레이(어둡게),
 * 글자 뒤에만 까는 글자 배경. 어둡게와 글자 배경은 따로 켜서 함께 쓸 수 있다.
 */
export function BackgroundControls({
  style,
  backgroundId,
  disabled,
  onUpdateStyle,
  onUpdateBackground,
}: BackgroundControlsProps): React.JSX.Element {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const background = useBackground(backgroundId);
  const textBackdropLabelId = useId();
  const { textBackdrop } = style;
  const updateTextBackdrop = (
    update: Partial<TextBackdrop>,
    coalesceField?: keyof TextBackdrop,
  ): void =>
    onUpdateStyle(
      { textBackdrop: { ...textBackdrop, ...update } },
      coalesceField && `textBackdrop.${coalesceField}`,
    );

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
              backgroundColor: resolveBackdropColor(
                style.backgroundColor,
                Boolean(background),
              ),
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
            <RibbonSlider
              label={EDITOR_COPY.ribbon.overlayOpacity}
              value={style.overlayOpacity}
              max={100}
              onChange={(overlayOpacity) =>
                onUpdateStyle({ overlayOpacity }, "overlayOpacity")
              }
            />
            <p className="text-xs text-muted-foreground">
              {EDITOR_COPY.ribbon.overlayHint}
            </p>
          </>
        )}
      </RibbonDropdown>

      <RibbonDropdown
        label={EDITOR_COPY.ribbon.textBackdrop}
        text={EDITOR_COPY.ribbon.textBackdrop}
        testId="text-backdrop-btn"
        disabled={disabled}
        panelClassName="w-60"
        icon={<HighlighterIcon />}
      >
        {() => (
          <>
            <div className="flex items-center justify-between">
              <span id={textBackdropLabelId} className="font-semibold">
                {EDITOR_COPY.ribbon.textBackdrop}
              </span>
              <Switch
                aria-labelledby={textBackdropLabelId}
                checked={textBackdrop.enabled}
                onMouseDown={(e) => e.preventDefault()}
                onCheckedChange={(enabled) => updateTextBackdrop({ enabled })}
              />
            </div>
            <RibbonSlider
              label={EDITOR_COPY.ribbon.textBackdropOpacity}
              value={textBackdrop.opacity}
              max={100}
              disabled={!textBackdrop.enabled}
              onChange={(opacity) => updateTextBackdrop({ opacity }, "opacity")}
            />
            <RibbonSlider
              label={EDITOR_COPY.ribbon.textBackdropPadding}
              value={textBackdrop.paddingPercent}
              max={60}
              disabled={!textBackdrop.enabled}
              onChange={(paddingPercent) =>
                updateTextBackdrop({ paddingPercent }, "paddingPercent")
              }
            />
            <RibbonSlider
              label={EDITOR_COPY.ribbon.textBackdropRadius}
              value={textBackdrop.radiusPercent}
              max={60}
              disabled={!textBackdrop.enabled}
              onChange={(radiusPercent) =>
                updateTextBackdrop({ radiusPercent }, "radiusPercent")
              }
            />
            <p className="text-xs text-muted-foreground">
              {EDITOR_COPY.ribbon.textBackdropHint}
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

function RibbonSlider({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const labelId = useId();
  return (
    <>
      <div className="flex items-center justify-between">
        <span id={labelId} className="font-semibold">
          {label}
        </span>
        <span className="font-mono">{value}%</span>
      </div>
      <Slider
        aria-labelledby={labelId}
        min={0}
        max={max}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
      />
    </>
  );
}
