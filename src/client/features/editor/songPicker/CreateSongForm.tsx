import React, { useId, useMemo, useState } from "react";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Field, FieldDescription, FieldLabel } from "#components/ui/field";
import { Textarea } from "#components/ui/textarea";
import { splitLyricsIntoSlides } from "#shared";
import { ExternalSearchLinks } from "../ExternalSearchLinks";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

export interface CreateSongValues {
  title: string;
  artist: string;
  lyricsRaw: string;
}

export interface CreateSongFormProps {
  initialTitle?: string;
  onCancel: () => void;
  onSubmit: (values: CreateSongValues) => void;
}

/**
 * 새 찬양 가사 직접 입력 폼.
 */
export function CreateSongForm({
  initialTitle = "",
  onCancel,
  onSubmit,
}: CreateSongFormProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle);
  const [artist, setArtist] = useState("");
  const [lyrics, setLyrics] = useState("");

  const previewSlides = useMemo(
    () => (lyrics.trim() ? splitLyricsIntoSlides(lyrics) : []),
    [lyrics],
  );
  const isValid = title.trim().length > 0 && previewSlides.length > 0;
  const fieldId = useId();

  return (
    <div className="flex flex-1 flex-col space-y-4 overflow-y-auto p-6">
      <div className="border-b pb-3">
        <h3 className="text-sm font-bold">{EDITOR_COPY.create.title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {EDITOR_COPY.create.description}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${fieldId}-title`}>
            {EDITOR_COPY.song.title} <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            id={`${fieldId}-title`}
            type="text"
            data-testid="song-picker-create-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={EDITOR_COPY.create.titlePlaceholder}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${fieldId}-artist`}>
            {EDITOR_COPY.song.artistOptional}
          </FieldLabel>
          <Input
            id={`${fieldId}-artist`}
            type="text"
            data-testid="song-picker-create-artist-input"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={EDITOR_COPY.create.artistPlaceholder}
          />
        </Field>
      </div>

      {title.trim() && (
        <div className="pt-1">
          <ExternalSearchLinks title={title} />
        </div>
      )}

      <Field className="min-h-56 flex-1">
        <FieldLabel htmlFor={`${fieldId}-lyrics`}>
          {EDITOR_COPY.create.lyricsLabel}{" "}
          <span className="text-destructive">*</span>
        </FieldLabel>
        <Textarea
          id={`${fieldId}-lyrics`}
          data-testid="song-picker-create-lyrics-input"
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={EDITOR_COPY.create.lyricsPlaceholder}
          className="flex-1 resize-none font-mono"
        />
        {previewSlides.length > 0 && (
          <FieldDescription>
            {EDITOR_COPY.create.splitCount(previewSlides.length)}
          </FieldDescription>
        )}
      </Field>

      <div className="flex items-center justify-end gap-2.5 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          {COMMON_COPY.cancel}
        </Button>
        <Button
          data-testid="song-picker-create-submit-btn"
          disabled={!isValid}
          onClick={() =>
            onSubmit({
              title: title.trim(),
              artist: artist.trim(),
              lyricsRaw: lyrics,
            })
          }
        >
          {EDITOR_COPY.create.submit}
        </Button>
      </div>
    </div>
  );
}
