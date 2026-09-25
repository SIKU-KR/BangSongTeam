import React, { useId, useMemo, useState } from "react";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Field, FieldDescription, FieldLabel } from "#components/ui/field";
import { Textarea } from "#components/ui/textarea";
import { splitLyricsIntoSlides } from "#shared";
import { ExternalSearchLinks } from "../ExternalSearchLinks";

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
        <h3 className="text-sm font-bold">새 찬양 가사 직접 입력</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          가사를 입력하면 빈 줄(엔터 2번) 기준으로 슬라이드가 자동 분할됩니다.
          빈 줄이 없으면 2줄씩 자동 분할됩니다. (슬라이드당 최대 4줄)
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${fieldId}-title`}>
            곡 제목 <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            id={`${fieldId}-title`}
            type="text"
            data-testid="song-picker-create-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 시간을 뚫고"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${fieldId}-artist`}>아티스트 (선택)</FieldLabel>
          <Input
            id={`${fieldId}-artist`}
            type="text"
            data-testid="song-picker-create-artist-input"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="예: WELOVE"
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
          가사 원문 붙여넣기 <span className="text-destructive">*</span>
        </FieldLabel>
        <Textarea
          id={`${fieldId}-lyrics`}
          data-testid="song-picker-create-lyrics-input"
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder={
            "당신은 시간을 뚫고\n이 땅 가운데 오셨네\n\n우리 없는 하늘을 원치 않아\n우리 삶에 오셨네"
          }
          className="flex-1 resize-none font-mono"
        />
        {previewSlides.length > 0 && (
          <FieldDescription>
            {previewSlides.length}개 슬라이드로 자동 분할됨
          </FieldDescription>
        )}
      </Field>

      <div className="flex items-center justify-end gap-2.5 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          취소
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
          보관함에 저장하고 프레젠테이션에 추가
        </Button>
      </div>
    </div>
  );
}
