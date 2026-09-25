import React, { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import type { BackgroundMedia } from "#shared";
import { BackgroundPreview, useBackgroundCatalog } from "../backgrounds";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";

export interface BackgroundPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBackgroundId?: string | null;
  onSelect: (backgroundId: string | null) => void;
}

const ALL_TAGS = "전체";

function CheckBadge(): React.JSX.Element {
  return (
    <div className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
      <CheckIcon className="size-3.5" strokeWidth={3} />
    </div>
  );
}

function tileClassName(isSelected: boolean): string {
  return cn(
    "group h-auto flex-col items-stretch justify-start gap-0 overflow-hidden rounded-xl p-0 text-left whitespace-normal",
    isSelected && "border-primary ring-2 ring-ring/50",
  );
}

function PickerTile({
  background,
  isSelected,
  onPick,
}: {
  background: BackgroundMedia;
  isSelected: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <Button
      variant="outline"
      data-testid={`bg-item-${background.id}`}
      aria-pressed={isSelected}
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={tileClassName(isSelected)}
    >
      <div className="relative w-full">
        <BackgroundPreview background={background} playing={hovered} />
        {isSelected && <CheckBadge />}
      </div>
      <div className="flex w-full flex-col gap-1 p-2.5">
        <span className="truncate text-xs font-semibold">
          {background.title}
        </span>
        {background.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {background.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Button>
  );
}

/**
 * 곡 배경 선택 창. 배경 갤러리에서 태그로 걸러 고르거나 배경을 뺀다.
 * 고르는 즉시 편집 미리보기에 반영되고 창이 닫힌다.
 */
export function BackgroundPickerModal(
  props: BackgroundPickerModalProps,
): React.JSX.Element | null {
  return props.isOpen ? <PickerDialog {...props} /> : null;
}

function PickerDialog({
  onClose,
  selectedBackgroundId,
  onSelect,
}: BackgroundPickerModalProps): React.JSX.Element {
  const catalog = useBackgroundCatalog();
  const [activeTag, setActiveTag] = useState<string>(ALL_TAGS);

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const all = catalog.backgrounds;
  const tags = [...new Set(all.flatMap((bg) => bg.tags))];
  const visible =
    activeTag === ALL_TAGS
      ? all
      : all.filter((bg) => bg.tags.includes(activeTag));

  const pick = (backgroundId: string | null): void => {
    onSelect(backgroundId);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-9/10 flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle className="text-lg font-bold">곡 배경 선택</DialogTitle>
          <DialogDescription className="text-xs">
            한 곡의 모든 슬라이드가 같은 배경을 씁니다. 영상은 슬라이드가
            넘어가도 끊기지 않고 이어집니다.
          </DialogDescription>
        </DialogHeader>

        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b bg-muted/40 px-6 py-3">
            {[ALL_TAGS, ...tags].map((tag) => (
              <Button
                key={tag}
                size="xs"
                variant={activeTag === tag ? "default" : "secondary"}
                aria-pressed={activeTag === tag}
                onClick={() => setActiveTag(tag)}
                className="shrink-0 rounded-full px-3"
              >
                {tag}
              </Button>
            ))}
          </div>
        )}

        <div className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-6 sm:grid-cols-3 md:grid-cols-4">
          <Button
            variant="outline"
            data-testid="bg-item-none"
            aria-pressed={!selectedBackgroundId}
            onClick={() => pick(null)}
            className={tileClassName(!selectedBackgroundId)}
          >
            <div className="relative flex aspect-video w-full items-center justify-center bg-black text-xs text-white/60">
              검은 화면
              {!selectedBackgroundId && <CheckBadge />}
            </div>
            <div className="w-full p-2.5">
              <span className="text-xs font-semibold">배경 없음</span>
            </div>
          </Button>

          {visible.map((bg) => (
            <PickerTile
              key={bg.id}
              background={bg}
              isSelected={bg.id === selectedBackgroundId}
              onPick={() => pick(bg.id)}
            />
          ))}

          {all.length === 0 && (
            <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
              <p>아직 등록된 배경이 없습니다.</p>
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 items-center px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {catalog.status === "offline"
              ? "오프라인: 저장해 둔 배경 목록입니다"
              : "고른 배경은 편집·송출 중에 이 기기에 저장되어 오프라인에서도 재생됩니다"}
          </span>
          <DialogClose
            data-testid="close-bg-modal-btn"
            render={<Button variant="outline" />}
          >
            닫기
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
