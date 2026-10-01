import React, { useState, useMemo, useEffect } from "react";
import { FileTextIcon } from "lucide-react";
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
import { Input } from "#components/ui/input";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "#components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "#components/ui/field";
import { Textarea } from "#components/ui/textarea";
import { splitLyricsIntoSlides, type Deck, type Slide } from "#shared";
import { ExternalSearchLinks } from "./ExternalSearchLinks";
import { createSongDeck } from "./songDeck";
import { getCurrentUserId } from "../../lib/auth";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

export interface QuickLyricPasteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToSet: (deck: Deck) => void;
}

/**
 * 가사를 붙여넣어 새 곡을 지금 프레젠테이션에 바로 추가하는 모달. 보관함에는 저장하지
 * 않는다. 열 때마다 빈 입력란으로 시작한다.
 */
export function QuickLyricPasteModal({
  isOpen,
  onClose,
  onAddToSet,
}: QuickLyricPasteModalProps): React.JSX.Element | null {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [lyricsRaw, setLyricsRaw] = useState("");

  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setArtist("");
      setLyricsRaw("");
    }
  }, [isOpen]);

  const slides: Slide[] = useMemo(() => {
    if (!lyricsRaw.trim()) return [];
    return splitLyricsIntoSlides(lyricsRaw);
  }, [lyricsRaw]);

  const isValid = title.trim().length > 0 && slides.length > 0;

  const handleAdd = (): void => {
    if (!isValid) return;

    const userId = getCurrentUserId();
    if (!userId) return;

    const newDeck = createSongDeck({
      userId,
      scope: "presentation",
      title,
      artist,
      lyricsRaw,
      slides,
    });

    onAddToSet(newDeck);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-9/10 flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="text-lg font-bold">
            {EDITOR_COPY.quickPaste.title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {EDITOR_COPY.quickPaste.description}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="song-title-input">
                {EDITOR_COPY.song.title}{" "}
                <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="song-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={EDITOR_COPY.quickPaste.titlePlaceholder}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="song-artist-input">
                {EDITOR_COPY.song.artistOptional}
              </FieldLabel>
              <Input
                id="song-artist-input"
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder={EDITOR_COPY.quickPaste.artistPlaceholder}
              />
            </Field>

            <ExternalSearchLinks title={title} />

            <Field className="flex-1">
              <FieldLabel htmlFor="song-lyrics-textarea">
                {EDITOR_COPY.quickPaste.lyricsLabel}{" "}
                <span className="text-destructive">*</span>
              </FieldLabel>
              <Textarea
                id="song-lyrics-textarea"
                value={lyricsRaw}
                onChange={(e) => setLyricsRaw(e.target.value)}
                placeholder={EDITOR_COPY.quickPaste.lyricsPlaceholder}
                className="min-h-56 flex-1 resize-none font-mono"
              />
            </Field>
          </FieldGroup>

          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                {EDITOR_COPY.quickPaste.preview}
              </span>
              <Badge variant="secondary" className="font-mono">
                {EDITOR_COPY.slide.pageCount(slides.length)}
              </Badge>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto">
              {slides.length === 0 ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FileTextIcon />
                    </EmptyMedia>
                    <EmptyDescription>
                      {EDITOR_COPY.quickPaste.emptyPreview}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                slides.map((slide) => (
                  <Card
                    key={slide.id || slide.order}
                    size="sm"
                    data-testid="slide-preview-card"
                  >
                    <CardHeader>
                      <CardTitle>
                        {EDITOR_COPY.slide.number(slide.order + 1)}
                      </CardTitle>
                      <CardAction>
                        <Badge variant="outline">
                          {EDITOR_COPY.slide.lineCount(slide.lines.length)}
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="space-y-1 text-xs">
                      {slide.lines.map((line, idx) => (
                        <div key={idx} className="truncate">
                          {line}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 px-6 py-4">
          <DialogClose render={<Button variant="outline" />}>
            {COMMON_COPY.cancel}
          </DialogClose>
          <Button onClick={handleAdd} disabled={!isValid}>
            {EDITOR_COPY.quickPaste.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
