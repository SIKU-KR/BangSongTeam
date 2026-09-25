import React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import type { DeckStyle, Slide } from "#shared";
import { SlideStage } from "../../components/stage/SlideStage";

const THUMB_WIDTH = 176;
const THUMB_HEIGHT = 99;

/** 썸네일 창에서 끌거나 놓는 대상. 슬라이드는 같은 곡 안, 곡은 곡끼리만 오간다 */
export type PaneDragData =
  | { type: "slide"; songIndex: number; slideIndex: number; slideId: string }
  | { type: "song"; songIndex: number };

/** 16:9 슬라이드 미리보기. 썸네일과 끌기 미리보기가 같이 쓴다 */
export function SlidePreview({
  slide,
  style,
  posterUrl,
  className,
  children,
}: {
  slide: Slide;
  style?: DeckStyle;
  posterUrl?: string;
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "relative aspect-video w-44 shrink-0 overflow-hidden rounded-md bg-black",
        className,
      )}
    >
      <div className="pointer-events-none size-full">
        <SlideStage
          slide={slide}
          style={style}
          posterUrl={posterUrl}
          staticBackground
          containerDimensions={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
        />
      </div>
      {children}
    </div>
  );
}

export interface SlideThumbnailProps {
  dragId: string;
  songIndex: number;
  slideIndex: number;
  number: number;
  slide: Slide;
  style?: DeckStyle;
  posterUrl?: string;
  current: boolean;
  selected: boolean;
  dimmed: boolean;
  warning: string;
  thumbRef?: React.Ref<HTMLDivElement>;
  onClick: (event: React.MouseEvent) => void;
}

/** 썸네일 창의 슬라이드 한 장. 끌 수도 있고, 같은 곡 슬라이드를 놓을 자리도 된다 */
export function SlideThumbnail({
  dragId,
  songIndex,
  slideIndex,
  number,
  slide,
  style,
  posterUrl,
  current,
  selected,
  dimmed,
  warning,
  thumbRef,
  onClick,
}: SlideThumbnailProps): React.JSX.Element {
  const data: PaneDragData = {
    type: "slide",
    songIndex,
    slideIndex,
    slideId: slide.id,
  };
  const draggable = useDraggable({ id: dragId, data });
  const droppable = useDroppable({ id: dragId, data });

  return (
    <div
      {...draggable.attributes}
      {...draggable.listeners}
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-current={current ? "true" : undefined}
      aria-label={`슬라이드 ${number}`}
      data-testid={`slide-thumb-${number - 1}`}
      data-slide-thumb=""
      data-song-index={songIndex}
      data-slide-index={slideIndex}
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer items-start gap-1.5 rounded-lg p-1.5 transition-colors outline-none",
        selected ? "bg-accent/80 shadow-xs" : "hover:bg-muted/50",
        dimmed && "opacity-50",
      )}
    >
      <div className="flex w-5 shrink-0 justify-end pt-1">
        <span
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full font-mono text-2xs transition-colors",
            selected
              ? "bg-primary font-bold text-primary-foreground shadow-xs"
              : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {number}
        </span>
      </div>

      <div ref={thumbRef}>
        <SlidePreview
          slide={slide}
          style={style}
          posterUrl={posterUrl}
          className={cn(
            "transition-all",
            selected
              ? "shadow-md ring-2 ring-primary ring-offset-2 ring-offset-background"
              : "ring-1 ring-border group-hover:ring-ring",
          )}
        >
          {warning && (
            <OverflowWarning
              testId={`slide-overflow-warning-${number - 1}`}
              message={warning}
              className="absolute bottom-1 left-1 z-30 rounded-sm bg-black/75 p-0.5 text-warning"
              iconClassName="size-3"
            />
          )}
        </SlidePreview>
      </div>
    </div>
  );
}

/**
 * 썸네일 사이 틈. 누르면 PowerPoint처럼 삽입 커서가 되고, 삽입 커서가 있거나
 * 끌어 놓을 자리일 때 가로선을 보여 준다.
 */
export function SlideGap({
  songIndex,
  index,
  active,
  onClick,
}: {
  songIndex: number;
  index: number;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <div
      data-testid={`slide-gap-${songIndex}-${index}`}
      data-slide-gap=""
      data-song-index={songIndex}
      data-gap-index={index}
      data-active={active || undefined}
      onClick={onClick}
      className="relative h-2 cursor-pointer"
    >
      {active && <PaneDropLine />}
    </div>
  );
}

/** 삽입 커서·끌어 놓을 자리를 가리키는 가로선. 틈 가운데나 곡 구역 위·아래에 둔다 */
export function PaneDropLine({
  position = "center",
}: {
  position?: "center" | "top" | "bottom";
}): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
        position === "center" && "top-1/2 -translate-y-1/2",
        position === "top" && "-top-1",
        position === "bottom" && "-bottom-1",
      )}
    />
  );
}

/** 넘침 경고 아이콘과 안내 툴팁 */
export function OverflowWarning({
  testId,
  message,
  className,
  iconClassName,
}: {
  testId: string;
  message: string;
  className?: string;
  iconClassName?: string;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            data-testid={testId}
            aria-label={message}
            className={cn("shrink-0", className)}
          />
        }
      >
        <TriangleAlertIcon className={cn("size-3.5", iconClassName)} />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 whitespace-pre-line">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}
