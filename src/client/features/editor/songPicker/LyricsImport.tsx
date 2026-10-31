import React, { useCallback, useState } from "react";
import type { LyricsCandidate, LyricsSearchQuery } from "#shared";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { EDITOR_COPY } from "#copy/editor";
import { describeApiError } from "../../../lib/api/request";
import {
  useFetchLyricsSong,
  useSearchLyrics,
} from "../../../lib/api/lyricsQueries";

export interface ImportedLyrics {
  title: string;
  artist: string;
  lyrics: string;
}

export interface LyricsImportController {
  isSearching: boolean;
  isImporting: boolean;
  candidates: LyricsCandidate[] | null;
  chosen: LyricsCandidate | null;
  error: Error | null;
  find: (query: LyricsSearchQuery) => void;
  choose: (candidate: LyricsCandidate) => void;
  reset: () => void;
}

/**
 * gasazip 후보 찾기와 고른 곡의 가사 받기를 묶은 상태.
 *
 * 외부 사이트는 `find`를 부를 때만 찾는다. 입력하는 동안에는 찾지 않는다. `reset`은 진행 중인
 * 요청의 결과도 버려서, 창을 다시 연 뒤 늦게 도착한 가사가 `onImport`를 부르지 않는다.
 */
export function useLyricsImport(
  onImport: (imported: ImportedLyrics) => void,
): LyricsImportController {
  const search = useSearchLyrics();
  const song = useFetchLyricsSong();
  const [chosen, setChosen] = useState<LyricsCandidate | null>(null);
  const { reset: resetSearch } = search;
  const { reset: resetSong } = song;

  const reset = useCallback((): void => {
    resetSearch();
    resetSong();
    setChosen(null);
  }, [resetSearch, resetSong]);

  return {
    isSearching: search.isPending,
    isImporting: song.isPending,
    candidates: search.isSuccess ? search.data : null,
    chosen,
    error: search.error ?? song.error,
    find: (query) => {
      song.reset();
      setChosen(null);
      search.mutate(query);
    },
    choose: (candidate) => {
      setChosen(candidate);
      song.mutate(candidate.ids, { onSuccess: onImport });
    },
    reset,
  };
}

/**
 * 가사 후보 찾기 결과: 빈 결과 안내, 고를 후보 목록, 서버 오류 문장.
 */
export function LyricsImportResults({
  controller,
  listClassName = "max-h-48",
}: {
  controller: LyricsImportController;
  listClassName?: string;
}): React.JSX.Element {
  const { candidates, chosen, error, isImporting, choose } = controller;

  return (
    <>
      {candidates?.length === 0 && (
        <p
          role="status"
          data-testid="song-picker-lyrics-import-empty"
          className="text-muted-foreground"
        >
          {EDITOR_COPY.lyricsImport.empty}
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-muted-foreground">
            {EDITOR_COPY.lyricsImport.pick}
          </p>
          <ul
            className={cn("flex flex-col gap-1 overflow-y-auto", listClassName)}
            data-testid="song-picker-lyrics-import-list"
          >
            {candidates.map((candidate) => (
              <li key={candidate.ids.join(",")}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  disabled={isImporting}
                  onClick={() => choose(candidate)}
                >
                  {isImporting && chosen === candidate
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
    </>
  );
}

interface LyricsImportProps {
  title: string;
  artist: string;
  onImport: (imported: ImportedLyrics) => void;
}

/**
 * 새 곡 폼에서 적은 제목·아티스트로 gasazip 가사를 불러오는 도구. 후보를 고르면 가사를 받아
 * 폼에 채울 수 있게 넘긴다.
 */
export function LyricsImport({
  title,
  artist,
  onImport,
}: LyricsImportProps): React.JSX.Element {
  const controller = useLyricsImport(onImport);
  const canSearch = title.trim().length > 0 && !controller.isSearching;

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          data-testid="song-picker-lyrics-import-btn"
          disabled={!canSearch}
          onClick={() =>
            controller.find({ title: title.trim(), artist: artist.trim() })
          }
        >
          {controller.isSearching
            ? EDITOR_COPY.lyricsImport.searching
            : EDITOR_COPY.lyricsImport.button}
        </Button>
        <span className="text-muted-foreground">
          {EDITOR_COPY.lyricsImport.source}
        </span>
      </div>

      <LyricsImportResults controller={controller} />
    </div>
  );
}
