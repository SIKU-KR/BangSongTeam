import React, { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";

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

/** hex 입력과 팝오버 컬러피커 컴포넌트. */
export function ColorPickerField({
  value,
  onCommit,
  className = "",
}: ColorPickerFieldProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState(value);
  const [pickerColor, setPickerColor] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value);
    setPickerColor(value);
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const commit = (hex: string) => {
    if (!isValidHex(hex)) return;
    const normalized = hex.toUpperCase();
    if (normalized === value.toUpperCase()) return;
    onCommit(normalized);
  };

  const isInvalid = !isValidHex(text);

  return (
    <div
      ref={rootRef}
      className={`relative flex items-center gap-1.5 ${className}`}
    >
      <button
        type="button"
        data-testid="color-picker-toggle"
        aria-label="컬러피커 열기"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        style={{ backgroundColor: isValidHex(value) ? value : "#FFFFFF" }}
        className="size-6 shrink-0 cursor-pointer rounded-md border-2 border-zinc-300 transition-transform hover:scale-110 dark:border-zinc-600"
        title="직접 색상 선택"
      />
      <input
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
        className={`w-20 rounded-sm border bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-700 uppercase dark:bg-zinc-900 dark:text-zinc-300 ${
          isInvalid
            ? "border-red-400 dark:border-red-500"
            : "border-zinc-200 dark:border-zinc-800"
        }`}
      />

      {isOpen && (
        <div
          data-testid="color-picker-popover"
          className="absolute top-full right-0 z-50 mt-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-xl"
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
        </div>
      )}
    </div>
  );
}
