import React, { useState } from "react";
import type { LyricsCandidate } from "#shared";
import { Button } from "#components/ui/button";
import { EDITOR_COPY } from "#copy/editor";
import { describeApiError } from "../../../lib/api/request";
import {
  useFetchLyricsSong,
  useSearchLyrics,
} from "../../../lib/api/lyricsQueries";

export interface ImportedLyrics {
  artist: string;
  lyrics: string;
}

interface LyricsImportProps {
  title: string;
  artist: string;
  onImport: (imported: ImportedLyrics) => void;
}

/**
 * gasazip에서 가사를 불러오는 새 곡 폼의 도구.
 *
 * 외부 사이트를 부르는 것은 버튼을 누를 때뿐이다. 입력하는 동안에는 찾지 않는다. 후보를 고르면
 * 가사를 받아 폼에 채울 수 있게 넘긴다.
 */
export function LyricsImport({
  title,
  artist,
  onImport,
}: LyricsImportProps): React.JSX.Element {
  const search = useSearchLyrics();
  const song = useFetchLyricsSong();
  const [chosen, setChosen] = useState<LyricsCandidate | null>(null);

  const canSearch = title.trim().length > 0 && !search.isPending;
  const error = search.error ?? song.error;

  const handleSearch = (): void => {
    song.reset();
    setChosen(null);
    search.mutate({ title: title.trim(), artist: artist.trim() });
  };

  const handleChoose = (candidate: LyricsCandidate): void => {
    setChosen(candidate);
    song.mutate(candidate.ids, {
      onSuccess: ({ artist: songArtist, lyrics }) =>
        onImport({ artist: songArtist, lyrics }),
    });
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          data-testid="song-picker-lyrics-import-btn"
          disabled={!canSearch}
          onClick={handleSearch}
        >
          {search.isPending
            ? EDITOR_COPY.lyricsImport.searching
            : EDITOR_COPY.lyricsImport.button}
        </Button>
        <span className="text-muted-foreground">
          {EDITOR_COPY.lyricsImport.source}
        </span>
      </div>

      {search.isSuccess && search.data.length === 0 && (
        <p
          role="status"
          data-testid="song-picker-lyrics-import-empty"
          className="text-muted-foreground"
        >
          {EDITOR_COPY.lyricsImport.empty}
        </p>
      )}

      {search.isSuccess && search.data.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-muted-foreground">
            {EDITOR_COPY.lyricsImport.pick}
          </p>
          <ul
            className="flex max-h-48 flex-col gap-1 overflow-y-auto"
            data-testid="song-picker-lyrics-import-list"
          >
            {search.data.map((candidate) => (
              <li key={candidate.ids.join(",")}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  disabled={song.isPending}
                  onClick={() => handleChoose(candidate)}
                >
                  {song.isPending && chosen === candidate
                    ? EDITOR_COPY.lyricsImport.importing
                    : EDITOR_COPY.lyricsImport.candidate(
                        candidate.title,
                        candidate.artist,
                      )}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="song-picker-lyrics-import-error"
          className="text-destructive"
        >
          {describeApiError(error)}
        </p>
      )}
    </div>
  );
}
