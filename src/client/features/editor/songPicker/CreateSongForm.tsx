import React, { useId, useMemo, useState } from "react";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Field, FieldDescription, FieldLabel } from "#components/ui/field";
import { Textarea } from "#components/ui/textarea";
import {
  MAX_DECK_ARTIST_LENGTH,
  MAX_DECK_TITLE_LENGTH,
  MAX_LYRICS_LENGTH,
  clampText,
  splitLyricsIntoSlides,
} from "#shared";
import { LyricsImport } from "./LyricsImport";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

export interface CreateSongValues {
  title: string;
  artist: string;
  lyricsRaw: string;
}

interface CreateSongFormProps {
  initialTitle?: string;
  initialArtist?: string;
  initialLyrics?: string;
  onCancel: () => void;
  onSubmit: (values: CreateSongValues) => void;
}

/**
 * 새 곡 가사 직접 입력 폼.
 *
 * 제목·아티스트·가사 칸은 곡 한도까지만 받는다. 검색어나 불러온 가사로 채운 초깃값도 한도로 줄여서 시작한다.
 * 브라우저는 한도를 넘게 붙여 넣은 가사를 말없이 잘라 내므로, 가사가 한도에 이르면 안내를 띄운다.
 */
export function CreateSongForm({
  initialTitle = "",
  initialArtist = "",
  initialLyrics = "",
  onCancel,
  onSubmit,
}: CreateSongFormProps): React.JSX.Element {
  const [title, setTitle] = useState(() =>
    clampText(initialTitle, MAX_DECK_TITLE_LENGTH),
  );
  const [artist, setArtist] = useState(() =>
    clampText(initialArtist, MAX_DECK_ARTIST_LENGTH),
  );
  const [lyrics, setLyrics] = useState(() =>
    clampText(initialLyrics, MAX_LYRICS_LENGTH),
  );

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
            maxLength={MAX_DECK_TITLE_LENGTH}
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
            maxLength={MAX_DECK_ARTIST_LENGTH}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={EDITOR_COPY.create.artistPlaceholder}
          />
        </Field>
      </div>

      <div className="pt-1">
        <LyricsImport
          title={title}
          artist={artist}
          onImport={(imported) => {
            setLyrics(imported.lyrics);
            if (!artist.trim()) {
              setArtist(clampText(imported.artist, MAX_DECK_ARTIST_LENGTH));
            }
          }}
        />
      </div>

      <Field className="min-h-56 flex-1">
        <FieldLabel htmlFor={`${fieldId}-lyrics`}>
          {EDITOR_COPY.create.lyricsLabel}{" "}
          <span className="text-destructive">*</span>
        </FieldLabel>
        <Textarea
          id={`${fieldId}-lyrics`}
          data-testid="song-picker-create-lyrics-input"
          value={lyrics}
          maxLength={MAX_LYRICS_LENGTH}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={EDITOR_COPY.create.lyricsPlaceholder}
          className="flex-1 resize-none font-mono"
        />
        {previewSlides.length > 0 && (
          <FieldDescription>
            {EDITOR_COPY.create.splitCount(previewSlides.length)}
          </FieldDescription>
        )}
        {lyrics.length >= MAX_LYRICS_LENGTH && (
          <FieldDescription>
            {EDITOR_COPY.create.lyricsLimit(MAX_LYRICS_LENGTH)}
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
