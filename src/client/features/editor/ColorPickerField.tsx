import React, { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#components/ui/popover";

const HEX_PATTERN = /^#([0-9a-fA-F]{3}){1,2}$/;

/** 유효한 hex 색상값인지 검증한다 (#RGB 또는 #RRGGBB). */
export function isValidHex(value: string): boolean {
  return HEX_PATTERN.test(value);
}

export interface ColorPickerFieldProps {
  value: string;
  onCommit: (hex: string) => void;
  className?: string;
}

/** hex 입력과 팝오버 컬러피커 컴포넌트. 피커는 손을 뗄 때 한 번만 커밋한다 */
export function ColorPickerField({
  value,
  onCommit,
  className,
}: ColorPickerFieldProps): React.JSX.Element {
  const [text, setText] = useState(value);
  const [pickerColor, setPickerColor] = useState(value);

  useEffect(() => {
    setText(value);
    setPickerColor(value);
  }, [value]);

  const commit = (hex: string) => {
    if (!isValidHex(hex)) return;
    const normalized = hex.toUpperCase();
    if (normalized === value.toUpperCase()) return;
    onCommit(normalized);
  };

  const isInvalid = !isValidHex(text);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Popover>
        <PopoverTrigger
          data-testid="color-picker-toggle"
          aria-label="컬러피커 열기"
          render={
            <Button
              variant="outline"
              size="icon-xs"
              className="border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: isValidHex(value) ? value : "#FFFFFF",
              }}
            />
          }
        />
        <PopoverContent
          data-testid="color-picker-popover"
          align="end"
          initialFocus={false}
          className="w-auto p-2"
          onPointerUp={() => commit(pickerColor)}
          onKeyUp={() => commit(pickerColor)}
        >
          <HexColorPicker
            color={isValidHex(pickerColor) ? pickerColor : "#FFFFFF"}
            onChange={(hex) => {
              setPickerColor(hex);
              setText(hex.toUpperCase());
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="text"
        data-testid="color-hex-input"
        aria-label="글자 색상 hex 값"
        aria-invalid={isInvalid}
        value={text}
        maxLength={7}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (isInvalid) setText(value);
          else commit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(text);
        }}
        className="h-7 w-24 font-mono text-xs uppercase md:text-xs"
      />
    </div>
  );
}
