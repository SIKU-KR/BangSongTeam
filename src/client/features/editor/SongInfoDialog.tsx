import React, { useEffect, useRef, useState } from "react";
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";

const MAX_FIELD_LENGTH = 100;

export interface SongInfoValues {
  title: string;
  artist: string;
}

export interface SongInfoDialogProps {
  heading: string;
  initialValues: SongInfoValues;
  notice?: React.ReactNode;
  onSubmit: (values: SongInfoValues) => void;
  onCancel: () => void;
}

/**
 * 곡 제목·아티스트 수정 대화 상자. 세트 곡과 보관함 곡이 함께 쓴다.
 * 길이 제한은 `DeckSchema`의 title·artist 최대 100자와 맞춘다.
 */
export function SongInfoDialog({
  heading,
  initialValues,
  notice,
  onSubmit,
  onCancel,
}: SongInfoDialogProps): React.JSX.Element {
  const [title, setTitle] = useState(initialValues.title);
  const [artist, setArtist] = useState(initialValues.artist);
  const titleRef = useRef<HTMLInputElement>(null);
  const isValid = title.trim().length > 0;

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent data-testid="song-info-dialog" initialFocus={titleRef}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValid) return;
            onSubmit({ title: title.trim(), artist: artist.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="song-info-title">
                곡 제목 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="song-info-title"
                ref={titleRef}
                type="text"
                data-testid="song-info-title-input"
                value={title}
                maxLength={MAX_FIELD_LENGTH}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="song-info-artist">아티스트 (선택)</Label>
              <Input
                id="song-info-artist"
                type="text"
                data-testid="song-info-artist-input"
                value={artist}
                maxLength={MAX_FIELD_LENGTH}
                onChange={(event) => setArtist(event.target.value)}
              />
            </div>
          </div>

          {notice && (
            <p className="text-xs/relaxed text-muted-foreground">{notice}</p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              취소
            </DialogClose>
            <Button
              type="submit"
              data-testid="song-info-save-btn"
              disabled={!isValid}
            >
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
