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
import { Label } from "#components/ui/label";
import { Textarea } from "#components/ui/textarea";
import {
  createId,
  Deck,
  DeckSchema,
  DEFAULT_DECK_STYLE,
  Slide,
  splitLyricsIntoSlides,
} from "#shared";
import { ExternalSearchLinks } from "./ExternalSearchLinks";
import { getCurrentUserId } from "../../lib/auth";

export interface QuickLyricPasteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToSet: (deck: Deck) => void;
  initialTitle?: string;
  initialArtist?: string;
  initialLyrics?: string;
  renderSearchLinks?: (title: string) => React.ReactNode;
}

/** 빠른 가사 붙여넣기로 새 곡을 세트에 추가하는 모달. */
export function QuickLyricPasteModal({
  isOpen,
  onClose,
  onAddToSet,
  initialTitle = "",
  initialArtist = "",
  initialLyrics = "",
  renderSearchLinks,
}: QuickLyricPasteModalProps): React.JSX.Element | null {
  const [title, setTitle] = useState(initialTitle);
  const [artist, setArtist] = useState(initialArtist);
  const [lyricsRaw, setLyricsRaw] = useState(initialLyrics);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setArtist(initialArtist);
      setLyricsRaw(initialLyrics);
    }
  }, [isOpen, initialTitle, initialArtist, initialLyrics]);

  const slides: Slide[] = useMemo(() => {
    if (!lyricsRaw.trim()) return [];
    return splitLyricsIntoSlides(lyricsRaw);
  }, [lyricsRaw]);

  const isValid = title.trim().length > 0 && slides.length > 0;

  const handleAdd = (): void => {
    if (!isValid) return;

    const userId = getCurrentUserId();
    if (!userId) return;

    const now = new Date().toISOString();
    const newDeck = DeckSchema.parse({
      id: createId(),
      userId,
      scope: "presentation",
      presentationId: null,
      title: title.trim(),
      artist: artist.trim(),
      lyricsRaw,
      slides,
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: now,
      updatedAt: now,
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
            빠른 가사 붙여넣기
          </DialogTitle>
          <DialogDescription className="text-xs">
            가사를 붙여넣으면 빈 줄 기준으로 슬라이드가 자동 분할됩니다. 빈 줄이
            없으면 2줄씩 자동 분할됩니다. (슬라이드당 최대 4줄)
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="song-title-input">
                곡 제목 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="song-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="곡 제목을 입력하세요 (예: 은혜로다)"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="song-artist-input">아티스트 / 작곡가</Label>
              <Input
                id="song-artist-input"
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="아티스트 (선택사항, 예: 손경민)"
              />
            </div>

            <div className="pt-1">
              {renderSearchLinks ? (
                renderSearchLinks(title)
              ) : (
                <ExternalSearchLinks title={title} />
              )}
            </div>

            <div className="flex min-h-56 flex-1 flex-col gap-1.5">
              <Label htmlFor="song-lyrics-textarea">
                가사 원문 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="song-lyrics-textarea"
                value={lyricsRaw}
                onChange={(e) => setLyricsRaw(e.target.value)}
                placeholder={
                  "가사를 여기에 붙여넣으세요...\n\n빈 줄로 슬라이드를 나눌 수 있으며, 4줄을 초과하면 2줄씩 자동 분할됩니다."
                }
                className="field-sizing-fixed min-h-56 flex-1 resize-none font-mono text-sm/relaxed md:text-sm/relaxed"
              />
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-lg border bg-muted/50 p-4">
            <div className="mb-3 flex items-center justify-between border-b pb-3">
              <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                슬라이드 분할 미리보기
              </span>
              <Badge variant="secondary" className="font-mono">
                총 {slides.length}장
              </Badge>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {slides.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
                  <FileTextIcon className="size-6" />
                  <p>
                    왼쪽 영역에 가사를 붙여넣으면
                    <br />
                    실시간으로 슬라이드가 분할되어 표시됩니다.
                  </p>
                </div>
              ) : (
                slides.map((slide) => (
                  <div
                    key={slide.id || slide.order}
                    data-testid="slide-preview-card"
                    className="rounded-lg border bg-card p-3 text-card-foreground shadow-sm"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold">
                        슬라이드 {slide.order + 1}
                      </span>
                      <Badge variant="outline">{slide.lines.length}줄</Badge>
                    </div>
                    <div className="space-y-1 text-xs">
                      {slide.lines.map((line, idx) => (
                        <div key={idx} className="truncate">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 px-6 py-4">
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button onClick={handleAdd} disabled={!isValid}>
            세트에 추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
