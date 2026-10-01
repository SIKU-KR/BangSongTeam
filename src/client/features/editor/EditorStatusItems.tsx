import React from "react";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import {
  MAX_SLIDE_LINE_LENGTH,
  MAX_SLIDE_LINES,
  type DeckOverflow,
} from "#shared";
import { EDITOR_COPY } from "#copy/editor";

/** 가사를 고치는 동안 상태 표시줄에 보이는 줄 수와 제한 안내 */
export function SlideLineStatus({
  lineCount,
  showLimitHint,
}: {
  lineCount: number;
  showLimitHint: boolean;
}): React.JSX.Element {
  return (
    <>
      <span aria-hidden="true">·</span>
      <span
        data-testid="slide-line-count"
        className={cn(
          "font-mono",
          lineCount >= MAX_SLIDE_LINES && "text-warning",
        )}
      >
        {EDITOR_COPY.slide.lineUsage(lineCount, MAX_SLIDE_LINES)}
      </span>
      {showLimitHint && (
        <span
          data-testid="slide-line-limit-hint"
          className="truncate text-warning"
        >
          {EDITOR_COPY.slide.lineLimit(MAX_SLIDE_LINES, MAX_SLIDE_LINE_LENGTH)}
        </span>
      )}
    </>
  );
}

/**
 * 곡이 무대를 넘치거나 지금 슬라이드가 줄바꿈될 때의 안내 문구.
 * 무대 넘침이 곡 전체 문제라 먼저 온다.
 */
export function getOverflowMessages(
  overflow: DeckOverflow | null,
  slideIndex: number,
): string[] {
  const candidates: Array<string | false | undefined> = [
    overflow?.exceedsStage && EDITOR_COPY.overflow.stage,
    overflow?.slides[slideIndex]?.wraps && EDITOR_COPY.overflow.wrap,
  ];
  return candidates.filter(
    (message): message is string => typeof message === "string",
  );
}

/** 넘침 안내. 첫 문구만 상태 표시줄에 두고, 전체는 툴팁으로 보여 준다 */
export function OverflowWarningStatus({
  messages,
}: {
  messages: readonly string[];
}): React.JSX.Element | null {
  if (messages.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            data-testid="overflow-warning-status"
            className="flex min-w-0 items-center gap-1 text-warning"
          />
        }
      >
        <TriangleAlertIcon className="size-3.5 shrink-0" />
        <span className="truncate">{messages[0]}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 whitespace-pre-line">
        {messages.join("\n")}
      </TooltipContent>
    </Tooltip>
  );
}
