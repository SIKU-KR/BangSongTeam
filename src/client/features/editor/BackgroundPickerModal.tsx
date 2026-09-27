import React, { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader } from "#components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import type { BackgroundMedia } from "#shared";
import { BackgroundPreview, useBackgroundCatalog } from "../backgrounds";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { COMMON_COPY } from "#copy/common";

export interface BackgroundPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBackgroundId?: string | null;
  onSelect: (backgroundId: string | null) => void;
}

const ALL_TAGS = COMMON_COPY.all;

function CheckBadge(): React.JSX.Element {
  return (
    <Badge className="absolute top-2 right-2">
      <CheckIcon />
      {BACKGROUND_COPY.selected}
    </Badge>
  );
}

/** 고르면 바로 적용되는 타일. 카드 전체를 누르거나 Enter·Space로 고른다 */
function selectableTile(
  selected: boolean,
  onPick: () => void,
): React.ComponentProps<typeof Card> {
  return {
    role: "button",
    tabIndex: 0,
    "aria-pressed": selected,
    onClick: onPick,
    onKeyDown: (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onPick();
    },
    className: cn(
      "cursor-pointer pt-0 outline-none hover:ring-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50",
      selected && "ring-2 ring-primary",
    ),
  };
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
    <Card
      size="sm"
      data-testid={`bg-item-${background.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...selectableTile(isSelected, onPick)}
    >
      <div className="relative">
        <BackgroundPreview background={background} playing={hovered} />
        {isSelected && <CheckBadge />}
      </div>
      <CardHeader>
        <CardTitle className="truncate">{background.title}</CardTitle>
        {background.tags.length > 0 && (
          <CardDescription className="flex flex-wrap gap-1">
            {background.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </CardDescription>
        )}
      </CardHeader>
    </Card>
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
          <DialogTitle className="text-lg font-bold">
            {BACKGROUND_COPY.picker.title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {BACKGROUND_COPY.picker.description}
          </DialogDescription>
        </DialogHeader>

        {tags.length > 0 && (
          <div className="overflow-x-auto border-b px-6 py-3">
            <ToggleGroup
              aria-label={BACKGROUND_COPY.moodTags}
              variant="outline"
              size="sm"
              value={[activeTag]}
              onValueChange={(next) => {
                if (next[0]) setActiveTag(next[0]);
              }}
            >
              {[ALL_TAGS, ...tags].map((tag) => (
                <ToggleGroupItem key={tag} value={tag}>
                  {tag}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        <div className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-6 sm:grid-cols-3 md:grid-cols-4">
          <Card
            size="sm"
            data-testid="bg-item-none"
            {...selectableTile(!selectedBackgroundId, () => pick(null))}
          >
            <div className="relative flex aspect-video items-center justify-center bg-black text-xs text-white/60">
              {BACKGROUND_COPY.blackScreen}
              {!selectedBackgroundId && <CheckBadge />}
            </div>
            <CardHeader>
              <CardTitle>{BACKGROUND_COPY.none}</CardTitle>
            </CardHeader>
          </Card>

          {visible.map((bg) => (
            <PickerTile
              key={bg.id}
              background={bg}
              isSelected={bg.id === selectedBackgroundId}
              onPick={() => pick(bg.id)}
            />
          ))}

          {all.length === 0 && (
            <Empty className="col-span-full">
              <EmptyHeader>
                <EmptyDescription>
                  {BACKGROUND_COPY.noBackgrounds}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 items-center px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {catalog.status === "offline"
              ? BACKGROUND_COPY.picker.offline
              : BACKGROUND_COPY.picker.cachedHint}
          </span>
          <DialogClose
            data-testid="close-bg-modal-btn"
            render={<Button variant="outline" />}
          >
            {COMMON_COPY.close}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
