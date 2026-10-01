import React from "react";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import type { BackgroundKindFilterValue } from "./backgroundSearch";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { COMMON_COPY } from "#copy/common";

const OPTIONS: ReadonlyArray<{
  value: BackgroundKindFilterValue;
  label: string;
}> = [
  { value: "all", label: COMMON_COPY.all },
  { value: "video", label: BACKGROUND_COPY.video },
  { value: "image", label: BACKGROUND_COPY.image },
];

export function BackgroundKindFilter({
  value,
  onChange,
  className,
}: {
  value: BackgroundKindFilterValue;
  onChange: (next: BackgroundKindFilterValue) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <ToggleGroup
      data-testid="bg-kind-filter"
      aria-label={BACKGROUND_COPY.kindFilter}
      variant="outline"
      size="sm"
      value={[value]}
      onValueChange={(next) => {
        const picked = OPTIONS.find((option) => option.value === next[0]);
        if (picked) onChange(picked.value);
      }}
      className={className}
    >
      {OPTIONS.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
