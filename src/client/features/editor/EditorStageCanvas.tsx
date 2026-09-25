import React, { Suspense, lazy, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileMusicIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { ButtonGroup, ButtonGroupText } from "#components/ui/button-group";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import { IconButton } from "#components/common/IconButton";
import type { Slide, DeckStyle, TextBoxPosition } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
import { SlideStage } from "../../components/stage/SlideStage";
import type { SnapGuides } from "./textBoxDrag";

const TextBoxMoveable = lazy(() =>
  import("./TextBoxMoveable").then((m) => ({ default: m.TextBoxMoveable })),
);

export interface EditorStageCanvasProps {
  slide?: Slide | null;
  style?: DeckStyle;
  backgroundUrl?: string;
  backgroundImageUrl?: string;
  posterUrl?: string;
  slideNumber: number;
  totalSlideCount: number;
  songNumber: number;
  totalSongs: number;
  onPrevSlide: () => void;
  onNextSlide: () => void;
  zoomLevel?: number;
  onZoomChange?: (zoom: number) => void;
  onOpenLyricModal?: () => void;
  onUpdateStyle?: (update: Partial<DeckStyle>) => void;
  /** 가사 줄 대신 텍스트 박스 안에 그릴 직접 편집기. 있으면 박스 이동·폭 조절을 끈다 */
  textEditor?: React.ReactNode;
  onRequestTextEdit?: () => void;
  /** 상태 표시줄 왼쪽에 덧붙일 항목 (줄 수, 넘침 경고) */
  statusItems?: React.ReactNode;
  className?: string;
}

/**
 * 슬라이드 편집 캔버스 작업 공간 컴포넌트.
 * 텍스트 박스 조작(react-moveable)은 고칠 수 있을 때만 따로 불러와, 보기 전용인
 * 공유 링크 미리보기는 그 청크를 받지 않는다.
 */
export function EditorStageCanvas({
  slide,
  style,
  backgroundUrl,
  backgroundImageUrl,
  posterUrl,
  slideNumber,
  totalSlideCount,
  songNumber,
  totalSongs,
  onPrevSlide,
  onNextSlide,
  zoomLevel = 100,
  onZoomChange,
  onOpenLyricModal,
  onUpdateStyle,
  textEditor,
  onRequestTextEdit,
  statusItems,
  className,
}: EditorStageCanvasProps): React.JSX.Element {
  const [textBoxEl, setTextBoxEl] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{
    position: TextBoxPosition;
    guides: SnapGuides;
  } | null>(null);

  const isEditingText = textEditor !== undefined;
  const baseStyle = style ?? DEFAULT_DECK_STYLE;
  const effectiveStyle = draft
    ? { ...baseStyle, position: draft.position }
    : baseStyle;
  const canEditTextBox = !!onUpdateStyle && !!slide && !isEditingText;
  const refreshKey = JSON.stringify([effectiveStyle, slide?.lines, zoomLevel]);
  const textContent = isEditingText ? (
    textEditor
  ) : slide && slide.lines.length === 0 && onRequestTextEdit ? (
    <div
      data-testid="empty-slide-placeholder"
      className="rounded-lg border-2 border-dashed border-current opacity-60"
      style={{ fontSize: "0.5em", paddingBlock: "0.3em" }}
    >
      더블클릭하여 가사 입력
    </div>
  ) : undefined;

  if (!slide || totalSlideCount === 0) {
    return (
      <div
        data-testid="editor-stage-canvas"
        className={cn(
          "relative flex flex-1 flex-col items-center justify-center overflow-hidden p-6 select-none",
          className,
        )}
      >
        <Empty className="max-w-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileMusicIcon />
            </EmptyMedia>
            <EmptyTitle>등록된 찬양 곡 또는 슬라이드가 없습니다</EmptyTitle>
            <EmptyDescription>
              새 찬양 가사를 빠른 입력으로 추가하여 프레젠테이션 제작을
              시작하세요.
            </EmptyDescription>
          </EmptyHeader>
          {onOpenLyricModal && (
            <EmptyContent>
              <Button onClick={onOpenLyricModal}>
                <PlusIcon />
                가사 붙여넣기로 새 곡 추가
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }

  const zoomScale = zoomLevel / 100;

  return (
    <div
      data-testid="editor-stage-canvas"
      className={cn(
        "relative flex flex-1 flex-col items-center justify-between overflow-hidden px-6 pt-6 pb-2 select-none",
        className,
      )}
    >
      <div className="flex w-full flex-1 items-center justify-center overflow-hidden py-2">
        <div
          data-editor-canvas
          tabIndex={-1}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            onRequestTextEdit?.();
          }}
          className="group relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl bg-black shadow-xl ring-1 ring-border transition-transform duration-150 outline-none"
          style={{
            transform: `scale(${zoomScale})`,
            transformOrigin: "center center",
          }}
        >
          <SlideStage
            slide={slide}
            style={effectiveStyle}
            backgroundUrl={backgroundUrl}
            backgroundImageUrl={backgroundImageUrl}
            posterUrl={posterUrl}
            textBoxRef={setTextBoxEl}
            isTextInteracting={draft !== null || isEditingText}
            textContent={textContent}
          />

          {draft?.guides.vertical && (
            <div
              data-testid="snap-guide-vertical"
              className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-px bg-white/80"
            />
          )}
          {draft?.guides.horizontal && (
            <div
              data-testid="snap-guide-horizontal"
              className="pointer-events-none absolute inset-x-0 top-1/2 z-30 h-px bg-white/80"
            />
          )}

          {canEditTextBox && (
            <Suspense fallback={null}>
              <TextBoxMoveable
                target={textBoxEl}
                refreshKey={refreshKey}
                onPreview={(position, guides) =>
                  setDraft(position ? { position, guides } : null)
                }
                onCommit={(position) => onUpdateStyle?.({ position })}
                onDoubleClick={onRequestTextEdit}
              />
            </Suspense>
          )}

          <IconButton
            label="이전 슬라이드 (◀)"
            size="icon-lg"
            data-testid="canvas-prev-btn"
            disabled={slideNumber <= 1}
            onClick={onPrevSlide}
            variant="secondary"
            className={cn(CANVAS_NAV_POSITION, "left-3")}
          >
            <ChevronLeftIcon />
          </IconButton>

          <IconButton
            label="다음 슬라이드 (▶)"
            size="icon-lg"
            data-testid="canvas-next-btn"
            disabled={slideNumber >= totalSlideCount}
            onClick={onNextSlide}
            variant="secondary"
            className={cn(CANVAS_NAV_POSITION, "right-3")}
          >
            <ChevronRightIcon />
          </IconButton>
        </div>
      </div>

      <div
        data-testid="editor-status-bar"
        className="mt-2 flex w-full max-w-4xl shrink-0 items-center justify-between gap-3 text-2xs text-muted-foreground"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono font-semibold text-foreground">
            슬라이드 {slideNumber}/{totalSlideCount}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">
            곡 {songNumber}/{totalSongs}
          </span>
          {statusItems}
        </div>

        {onZoomChange && (
          <ButtonGroup className="hidden sm:flex">
            <IconButton
              label="캔버스 축소"
              variant="outline"
              size="icon-sm"
              onClick={() => onZoomChange(Math.max(50, zoomLevel - 15))}
            >
              <MinusIcon />
            </IconButton>
            <ButtonGroupText className="w-14 justify-center font-mono text-xs">
              {zoomLevel}%
            </ButtonGroupText>
            <IconButton
              label="캔버스 확대"
              variant="outline"
              size="icon-sm"
              onClick={() => onZoomChange(Math.min(150, zoomLevel + 15))}
            >
              <PlusIcon />
            </IconButton>
            <IconButton
              label="100% 원본 맞춤"
              variant="outline"
              size="sm"
              onClick={() => onZoomChange(100)}
            >
              맞춤
            </IconButton>
          </ButtonGroup>
        )}
      </div>
    </div>
  );
}

/** 슬라이드 위 이전·다음 버튼의 자리. 마우스를 올렸을 때만 보인다 */
const CANVAS_NAV_POSITION =
  "absolute top-1/2 z-40 -translate-y-1/2 rounded-full opacity-0 group-hover:opacity-100 disabled:opacity-0";
