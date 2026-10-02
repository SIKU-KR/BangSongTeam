import React, { useEffect, useState } from "react";
import { ButtonGroup } from "#components/ui/button-group";
import { Input } from "#components/ui/input";
import { RibbonChoices, RibbonDropdown } from "./RibbonDropdown";
import { RibbonTooltip } from "./RibbonPrimitives";
import { FONT_SIZE_PT_PRESETS, ptToVw, vwToPt } from "./ribbonOptions";
import { EDITOR_COPY } from "#copy/editor";

interface FontSizeFieldProps {
  fontSizeVw: number;
  disabled: boolean;
  onChange: (fontSizeVw: number) => void;
}

/**
 * 리본 글자 크기 입력과 크기 목록. 저장값은 vw지만 PowerPoint처럼 pt로 보여 주고,
 * 입력 중인 값은 Enter나 포커스를 벗어날 때만 반영한다. 잘못된 값이면 원래 크기로 되돌린다.
 */
export function FontSizeField({
  fontSizeVw,
  disabled,
  onChange,
}: FontSizeFieldProps): React.JSX.Element {
  const sizePt = vwToPt(fontSizeVw);
  const [sizeText, setSizeText] = useState(String(sizePt));

  useEffect(() => {
    setSizeText(String(sizePt));
  }, [sizePt]);

  const commitSize = () => {
    const pt = Number(sizeText);
    if (sizeText.trim() && Number.isFinite(pt) && pt > 0) {
      onChange(ptToVw(pt));
    }
    setSizeText(String(sizePt));
  };

  return (
    <ButtonGroup>
      <RibbonTooltip content={EDITOR_COPY.ribbon.fontSizeTooltip}>
        <Input
          type="text"
          inputMode="numeric"
          aria-label={EDITOR_COPY.ribbon.fontSize}
          value={sizeText}
          disabled={disabled}
          onChange={(e) => setSizeText(e.target.value)}
          onBlur={commitSize}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitSize();
            }
            if (e.key === "Escape") setSizeText(String(sizePt));
          }}
          className="w-12 text-center font-mono"
        />
      </RibbonTooltip>
      <RibbonDropdown
        label={EDITOR_COPY.ribbon.fontSizeList}
        testId="font-size-list-btn"
        disabled={disabled}
        panelClassName="max-h-72 w-20 overflow-y-auto p-1"
      >
        {(close) => (
          <RibbonChoices
            label={EDITOR_COPY.ribbon.fontSizeList}
            className="font-mono"
            value={String(sizePt)}
            choices={FONT_SIZE_PT_PRESETS.map((pt) => ({
              value: String(pt),
              label: pt,
            }))}
            onSelect={(value) => {
              onChange(ptToVw(Number(value)));
              close();
            }}
          />
        )}
      </RibbonDropdown>
    </ButtonGroup>
  );
}
