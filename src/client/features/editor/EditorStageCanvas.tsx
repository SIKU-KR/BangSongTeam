import React, { Suspense, lazy, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileMusicIcon,
  ListIcon,
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
import { useStageWidthLimit } from "#hooks/useStageWidthLimit";
import type { Slide, DeckStyle, TextBoxPosition } from "#shared";
import { SlideStage } from "../../components/stage/SlideStage";
import type { SnapGuides } from "./textBoxDrag";
import { EDITOR_COPY } from "#copy/editor";

const ZOOM_PERCENT = { min: 50, max: 150, step: 15, fit: 100 } as const;

const TextBoxMoveable = lazy(() =>
  import("./TextBoxMoveable").then((m) => ({ default: m.TextBoxMoveable })),
);

interface EditorStageCanvasProps {
  slide?: Slide | null;
  style: DeckStyle;
  backgroundUrl?: string;
  backgroundImageUrl?: string;
  posterUrl?: string;
  slideNumber: number;
  totalSlideCount: number;
  songNumber: number;
  totalSongs: number;
  onPrevSlide: () => void;
  onNextSlide: () => void;
  onOpenLyricModal?: () => void;
  onUpdateStyle?: (update: Partial<DeckStyle>) => void;
  /** 가사 줄 대신 텍스트 박스 안에 그릴 직접 편집기. 있으면 박스 이동·폭 조절을 끈다 */
  textEditor?: React.ReactNode;
  onRequestTextEdit?: () => void;
  /** 상태 표시줄 왼쪽에 덧붙일 항목 (줄 수, 넘침 경고) */
  statusItems?: React.ReactNode;
  /** 폰 폭에서만 넘긴다. 접어 둔 슬라이드 목록을 여는 버튼을 상태 표시줄에 둔다 */
  onOpenSlideList?: () => void;
}

/**
 * 슬라이드 편집 캔버스 작업 공간 컴포넌트.
 * 텍스트 박스 조작(react-moveable)은 고칠 수 있을 때만 따로 불러와, 보기 전용인
 * 공유 링크 미리보기는 그 청크를 받지 않는다.
 *
 * 슬라이드는 작업 공간의 폭과 높이 중 더 모자란 쪽에 맞춰 통째로 보인다. 폭만 보고 맞추면 높이가
 * 모자란 가로 폰에서 슬라이드의 위아래가 잘린다(`useStageWidthLimit`).
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
  onOpenLyricModal,
  onUpdateStyle,
  textEditor,
  onRequestTextEdit,
  statusItems,
  onOpenSlideList,
}: EditorStageCanvasProps): React.JSX.Element {
  const [textBoxEl, setTextBoxEl] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{
    position: TextBoxPosition;
    guides: SnapGuides;
  } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(ZOOM_PERCENT.fit);
  const [stageArea, setStageArea] = useState<HTMLDivElement | null>(null);
  const stageWidthCap = useStageWidthLimit(stageArea);

  const isEditingText = textEditor !== undefined;
  const effectiveStyle = draft ? { ...style, position: draft.position } : style;
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
      {EDITOR_COPY.slide.emptyPlaceholder}
    </div>
  ) : undefined;

  if (!slide || totalSlideCount === 0) {
    return (
      <div
        data-testid="editor-stage-canvas"
        className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-6 select-none"
      >
        <Empty className="max-w-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileMusicIcon />
            </EmptyMedia>
            <EmptyTitle>{EDITOR_COPY.canvas.emptyTitle}</EmptyTitle>
            <EmptyDescription>
              {EDITOR_COPY.canvas.emptyDescription}
            </EmptyDescription>
          </EmptyHeader>
          {(onOpenLyricModal || onOpenSlideList) && (
            <EmptyContent>
              {onOpenLyricModal && (
                <Button onClick={onOpenLyricModal}>
                  <PlusIcon />
                  {EDITOR_COPY.canvas.pasteNewSong}
                </Button>
              )}
              {onOpenSlideList && <SlideListButton onClick={onOpenSlideList} />}
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }

  const zoomScale = zoomLevel / 100;
  const navVertical =
    stageWidthCap !== null && stageWidthCap < COMPACT_STAGE_WIDTH
      ? NAV_AT_BOTTOM
      : NAV_CENTERED;

  return (
    <div
      data-testid="editor-stage-canvas"
      className="relative flex flex-1 flex-col items-center justify-between overflow-hidden px-6 pt-6 pb-2 select-none max-md:px-3 max-md:pt-3"
    >
      <div
        ref={setStageArea}
        className="flex w-full flex-1 items-center justify-center overflow-hidden py-2"
      >
        <div
          data-editor-canvas
          tabIndex={-1}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            onRequestTextEdit?.();
          }}
          className="group relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl bg-black shadow-xl ring-1 ring-border transition-transform duration-150 outline-none"
          style={{
            width:
              stageWidthCap === null
                ? undefined
                : `min(100%, ${stageWidthCap}px)`,
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
                onCommit={(position) => onUpdateStyle({ position })}
                onDoubleClick={onRequestTextEdit}
              />
            </Suspense>
          )}

          <IconButton
            label={EDITOR_COPY.canvas.prev}
            size="icon-lg"
            data-testid="canvas-prev-btn"
            disabled={slideNumber <= 1}
            onClick={onPrevSlide}
            variant="secondary"
            className={cn(
              CANVAS_NAV_POSITION,
              navVertical,
              "left-3 [@media(hover:none)]:left-1",
            )}
          >
            <ChevronLeftIcon />
          </IconButton>

          <IconButton
            label={EDITOR_COPY.canvas.next}
            size="icon-lg"
            data-testid="canvas-next-btn"
            disabled={slideNumber >= totalSlideCount}
            onClick={onNextSlide}
            variant="secondary"
            className={cn(
              CANVAS_NAV_POSITION,
              navVertical,
              "right-3 [@media(hover:none)]:right-1",
            )}
          >
            <ChevronRightIcon />
          </IconButton>
        </div>
      </div>

      <div
        data-testid="editor-status-bar"
        className="mt-2 flex w-full max-w-4xl shrink-0 items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <div className="flex min-w-0 items-center gap-2 max-md:flex-wrap max-md:gap-y-1">
          {onOpenSlideList && <SlideListButton onClick={onOpenSlideList} />}
          <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-2 py-0.5 font-mono font-semibold whitespace-nowrap text-foreground">
            {EDITOR_COPY.canvas.slidePosition(slideNumber, totalSlideCount)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 font-mono whitespace-nowrap">
            {EDITOR_COPY.canvas.songPosition(songNumber, totalSongs)}
          </span>
          {statusItems}
        </div>

        <ButtonGroup className="hidden sm:flex">
          <IconButton
            label={EDITOR_COPY.canvas.zoomOut}
            variant="outline"
            size="icon-sm"
            onClick={() =>
              setZoomLevel(
                Math.max(ZOOM_PERCENT.min, zoomLevel - ZOOM_PERCENT.step),
              )
            }
          >
            <MinusIcon />
          </IconButton>
          <ButtonGroupText className="w-14 justify-center font-mono text-xs">
            {zoomLevel}%
          </ButtonGroupText>
          <IconButton
            label={EDITOR_COPY.canvas.zoomIn}
            variant="outline"
            size="icon-sm"
            onClick={() =>
              setZoomLevel(
                Math.min(ZOOM_PERCENT.max, zoomLevel + ZOOM_PERCENT.step),
              )
            }
          >
            <PlusIcon />
          </IconButton>
          <IconButton
            label={EDITOR_COPY.canvas.fitLabel}
            variant="outline"
            size="sm"
            onClick={() => setZoomLevel(ZOOM_PERCENT.fit)}
          >
            {EDITOR_COPY.canvas.fit}
          </IconButton>
        </ButtonGroup>
      </div>
    </div>
  );
}

function SlideListButton({
  onClick,
}: {
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="open-slide-list-btn"
      onClick={onClick}
    >
      <ListIcon />
      {EDITOR_COPY.thumbnails.list}
    </Button>
  );
}

/**
 * 슬라이드 위 이전·다음 버튼의 자리. 마우스 기기에서는 마우스를 올렸을 때만 보인다. 올릴 마우스가 없는
 * 터치 기기(`@media(hover:none)`)에서는 늘 보이되, 가사를 덜 가리도록 불투명도를 줄이고 가장자리에 바짝
 * 붙이며, 손가락으로 누를 44px은 지킨다. 눌러도 갈 곳이 없는 버튼은 어느 기기에서나 가린다. 높이는
 * `NAV_CENTERED`나 `NAV_AT_BOTTOM`이 정한다.
 */
const CANVAS_NAV_POSITION =
  "absolute z-40 rounded-full opacity-0 group-hover:opacity-100 disabled:opacity-0 [@media(hover:none)]:size-11 [@media(hover:none)]:opacity-70";

const NAV_CENTERED = "top-1/2 -translate-y-1/2";

const NAV_AT_BOTTOM = "bottom-1";

/**
 * 슬라이드 폭(px)이 이보다 좁으면 이전·다음 버튼을 가운데 높이에서 아래쪽 모서리로 옮긴다. 글상자 양 끝의
 * 조작 핸들은 기본 자리에서 슬라이드 가장자리로부터 폭의 10%, 가운데 높이에 있다. 가로로 돌린 폰처럼
 * 슬라이드가 330px쯤보다 좁아지면 버튼 한가운데(터치에서는 가장자리로부터 26px)가 핸들에 덮여, 눌러도
 * 버튼이 아니라 핸들이 잡힌다. 폰 세로의 폭 366px에서는 덮이지 않는다.
 */
const COMPACT_STAGE_WIDTH = 340;
