import React, { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import { RibbonTooltip } from "./RibbonPrimitives";

export interface RibbonDropdownProps {
  label: string;
  icon?: React.ReactNode;
  text?: string;
  disabled?: boolean;
  testId?: string;
  panelTestId?: string;
  panelClassName?: string;
  align?: "start" | "end";
  children: (close: () => void) => React.ReactNode;
}

/**
 * 리본의 펼침 패널. 열 때 포커스를 옮기지 않아, 가사 편집 중에 글자 크기·색을
 * 바꿔도 textarea의 커서가 그대로 남는다. 패널 안 버튼도 mousedown을 막아야 한다.
 */
export function RibbonDropdown({
  label,
  icon,
  text,
  disabled,
  testId,
  panelTestId,
  panelClassName,
  align = "start",
  children,
}: RibbonDropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <RibbonTooltip content={label}>
        <PopoverTrigger
          data-testid={testId}
          aria-label={label}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          render={<Button variant="ghost" size="sm" />}
        >
          {icon}
          {text && <span className="hidden xl:inline">{text}</span>}
          <ChevronDownIcon className="opacity-60" />
        </PopoverTrigger>
      </RibbonTooltip>
      <PopoverContent
        data-testid={panelTestId}
        align={align}
        initialFocus={false}
        finalFocus={false}
        className={cn("w-56 text-xs", panelClassName)}
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/** 펼침 패널 안의 선택지 목록 (글자 크기·줄 간격·그림자). 고르면 `onSelect`를 부른다 */
export function RibbonChoices({
  label,
  choices,
  value,
  onSelect,
  className,
}: {
  label: string;
  choices: ReadonlyArray<{ value: string; label: React.ReactNode }>;
  value: string;
  onSelect: (value: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <ToggleGroup
      aria-label={label}
      orientation="vertical"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked !== undefined) onSelect(picked);
      }}
      className="w-full"
    >
      {choices.map((choice) => (
        <ToggleGroupItem
          key={choice.value}
          value={choice.value}
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          className={cn("justify-start", className)}
        >
          {choice.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
