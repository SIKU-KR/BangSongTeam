import React, { useState } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import { Card } from "#components/ui/card";
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
import { SearchInput } from "#components/common/SearchInput";
import { DEFAULT_BACKGROUND_COLOR, type BackgroundMedia } from "#shared";
import { BackgroundKindFilter, BackgroundPreview } from "../backgrounds";
import {
  describeBackgroundGalleryEmpty,
  useBackgroundGallery,
} from "../backgrounds/useBackgroundGallery";
import { useBackgroundSearchPlaceholder } from "../backgrounds/useBackgroundSearchPlaceholder";
import type { BackgroundChoice } from "../presentation/presentationStore";
import { ColorPalette } from "./ColorPalette";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { COMMON_COPY } from "#copy/common";

interface BackgroundPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBackgroundId?: string | null;
  /** 곡 서식의 단색. 배경 영상·이미지가 없을 때만 선택된 것으로 보인다 */
  selectedColor?: string;
  onSelect: (choice: BackgroundChoice) => void;
}

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
      "cursor-pointer py-0 outline-none hover:ring-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50",
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
  const [isFocused, setIsFocused] = useState(false);
  return (
    <Card
      size="sm"
      data-testid={`bg-item-${background.id}`}
      {...selectableTile(isSelected, onPick)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <div className="relative">
        <BackgroundPreview background={background} active={isFocused} />
        {isSelected && <CheckBadge />}
      </div>
    </Card>
  );
}

/**
 * 곡 배경 선택 창. 위쪽의 단색 팔레트나 아래 배경 갤러리(종류·검색어로 거름)에서 고른다.
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
  selectedColor,
  onSelect,
}: BackgroundPickerModalProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const placeholder = useBackgroundSearchPlaceholder(draft === "");
  const {
    catalog,
    kind,
    setKind,
    visibleBackgrounds,
    hasAnyBackground,
    emptyReason,
  } = useBackgroundGallery(query);

  const pick = (choice: BackgroundChoice): void => {
    onSelect(choice);
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

        <div className="flex-1 overflow-y-auto">
          <section className="space-y-2 border-b px-6 py-4">
            <h3 className="text-sm font-semibold">
              {BACKGROUND_COPY.picker.solid}
            </h3>
            <ColorPalette
              label={BACKGROUND_COPY.picker.solid}
              testId="bg-solid-palette"
              value={
                selectedBackgroundId
                  ? undefined
                  : (selectedColor ?? DEFAULT_BACKGROUND_COLOR)
              }
              onPick={(color) => pick({ color })}
            />
          </section>

          <section className="space-y-3 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {BACKGROUND_COPY.picker.media}
              </h3>
              {hasAnyBackground && (
                <BackgroundKindFilter value={kind} onChange={setKind} />
              )}
            </div>
            {hasAnyBackground && (
              <SearchInput
                value={draft}
                onValueChange={(next) => {
                  setDraft(next);
                  if (next.trim() === "") setQuery("");
                }}
                onSubmit={() => setQuery(draft.trim())}
                label={BACKGROUND_COPY.picker.searchLabel}
                placeholder={placeholder}
                testId="bg-picker-search-input"
              />
            )}
            <div className="grid grid-cols-2 content-start gap-4 sm:grid-cols-3 md:grid-cols-4">
              {visibleBackgrounds.map((bg) => (
                <PickerTile
                  key={bg.id}
                  background={bg}
                  isSelected={bg.id === selectedBackgroundId}
                  onPick={() => pick({ backgroundId: bg.id })}
                />
              ))}

              {emptyReason && (
                <Empty className="col-span-full">
                  <EmptyHeader>
                    <EmptyDescription>
                      {describeBackgroundGalleryEmpty(emptyReason, query)}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="mx-0 mb-0 items-center px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {catalog.status === "offline"
              ? BACKGROUND_COPY.offline
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
