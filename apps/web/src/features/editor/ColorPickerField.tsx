import React, { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";

const HEX_PATTERN = /^#([0-9a-fA-F]{3}){1,2}$/;

/**
 * DeckStyleSchema의 색상 정규식과 동일한 검증 (#RGB / #RRGGBB)
 */
export function isValidHex(value: string): boolean {
  return HEX_PATTERN.test(value);
}

export interface ColorPickerFieldProps {
  value: string;
  onCommit: (hex: string) => void;
  className?: string;
}

/**
 * hex 입력 + react-colorful 팝오버 컬러피커.
 * 스토어의 updateSongStyle은 호출마다 히스토리를 쌓으므로, 드래그·타이핑 중에는
 * 로컬 draft만 갱신하고 손을 뗄 때(pointerup/keyup/blur/Enter)에만 1회 커밋한다.
 */
export function ColorPickerField({
  value,
  onCommit,
  className = "",
}: ColorPickerFieldProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState(value);
  const [pickerColor, setPickerColor] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  // 외부(프리셋 스와치, 곡 전환, Undo)에서 값이 바뀌면 표시값 동기화
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
        className="w-6 h-6 rounded-md border-2 border-zinc-300 dark:border-zinc-600 cursor-pointer shrink-0 hover:scale-110 transition-transform"
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
        className={`w-20 bg-zinc-50 dark:bg-zinc-900 border rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 uppercase ${
          isInvalid
            ? "border-red-400 dark:border-red-500"
            : "border-zinc-200 dark:border-zinc-800"
        }`}
      />

      {isOpen && (
        <div
          data-testid="color-picker-popover"
          className="absolute right-0 top-full mt-2 z-50 p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-md dark:shadow-xl"
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
