import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, DownloadIcon, PlusIcon } from "lucide-react";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "#components/ui/empty";
import { SearchInput } from "#components/common/SearchInput";
import { deckMatchesQuery, type Deck } from "#shared";
import { saveSongToLibrary, useUserSongs } from "./songLibraryStore";
import {
  CreateSongForm,
  type CreateSongValues,
} from "./songPicker/CreateSongForm";
import {
  LyricsImportResults,
  useLyricsImport,
  type ImportedLyrics,
} from "./songPicker/LyricsImport";
import { MyDeckPreview } from "./songPicker/SongPickerPreview";
import { SongPickerEntryRow } from "./songPicker/SongPickerEntryRow";
import {
  LibrarySongDialog,
  type LibrarySongDialogRequest,
} from "./songPicker/LibrarySongDialog";
import { EDITOR_COPY } from "#copy/editor";

interface SongPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSong: (deck: Deck) => void;
  /** 열릴 때 보여 줄 화면. `create`는 목록을 건너뛰고 가사 직접 입력 폼을 바로 연다. */
  initialMode?: SongPickerMode;
}

export type SongPickerMode = "browse" | "create";

type PickerView = SongPickerMode | "import";

/**
 * 곡 선택 모달. 내 보관함 곡만 검색어로 로컬에서 걸러 보여 주고, 새 가사를 입력하면
 * 보관함에 저장한 뒤 바로 프레젠테이션에 넣는다. 검색어로 gasazip 가사를 불러오면
 * 그 가사를 채운 새 곡 폼으로 넘어가 확인한 뒤 저장한다.
 */
export function SongPickerModal({
  isOpen,
  onClose,
  onSelectSong,
  initialMode = "browse",
}: SongPickerModalProps): React.JSX.Element | null {
  const mySongs = useUserSongs();

  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<PickerView>("browse");
  const [createDraft, setCreateDraft] = useState<ImportedLyrics | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryDialog, setLibraryDialog] =
    useState<LibrarySongDialogRequest | null>(null);

  const lyricsImport = useLyricsImport((imported) => {
    setCreateDraft(imported);
    setMode("create");
  });
  const { reset: resetLyricsImport } = lyricsImport;

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setMode(initialMode);
      setSelectedId(null);
      setCreateDraft(null);
      resetLyricsImport();
    }
  }, [isOpen, initialMode, resetLyricsImport]);

  const entries = useMemo<Deck[]>(() => {
    const q = searchQuery.trim();
    return q ? mySongs.filter((deck) => deckMatchesQuery(deck, q)) : mySongs;
  }, [mySongs, searchQuery]);

  const selected = entries.find((deck) => deck.id === selectedId) ?? entries[0];

  const query = searchQuery.trim();
  const emptyMessage = query
    ? EDITOR_COPY.picker.noMatch
    : EDITOR_COPY.picker.noSongs;

  const startCreate = (): void => {
    setCreateDraft(null);
    setMode("create");
  };

  const importLyrics = (): void => {
    lyricsImport.find({ title: query, artist: "" });
    setMode("import");
  };

  const addDeck = (deck: Deck): void => {
    onSelectSong(deck);
    onClose();
  };

  const handleCreateSubmit = (values: CreateSongValues): void => {
    const saved = saveSongToLibrary({
      title: values.title,
      artist: values.artist,
      lyricsRaw: values.lyricsRaw,
    });
    setMode("browse");
    addDeck(saved);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="song-picker-modal"
        className="flex h-9/10 max-h-212 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-bold">
              {EDITOR_COPY.song.addSong}
            </DialogTitle>
            <Badge variant="secondary" className="font-mono">
              {mySongs.length}
            </Badge>
          </div>
          <DialogDescription className="text-xs">
            {EDITOR_COPY.picker.description}
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="song-picker-body"
          className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:overflow-y-auto md:flex-row"
        >
          <div className="flex w-full shrink-0 flex-col border-b max-md:max-h-72 md:w-5/12 md:border-r md:border-b-0 lg:w-4/12">
            <div className="shrink-0 space-y-2.5 border-b p-3.5">
              <SearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                label={EDITOR_COPY.picker.searchLabel}
                placeholder={EDITOR_COPY.picker.searchPlaceholder}
                testId="song-picker-search-input"
              />

              <div className="flex items-center justify-end gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  data-testid="song-picker-browse-import-btn"
                  disabled={!query || lyricsImport.isSearching}
                  onClick={importLyrics}
                >
                  <DownloadIcon />
                  {lyricsImport.isSearching
                    ? EDITOR_COPY.lyricsImport.searching
                    : EDITOR_COPY.lyricsImport.button}
                </Button>
                <Button
                  size="xs"
                  variant={mode === "browse" ? "outline" : "secondary"}
                  data-testid="song-picker-switch-create-btn"
                  onClick={() =>
                    mode === "browse" ? startCreate() : setMode("browse")
                  }
                >
                  {mode !== "browse" ? (
                    <>
                      <ArrowLeftIcon />
                      {EDITOR_COPY.picker.showList}
                    </>
                  ) : (
                    <>
                      <PlusIcon />
                      {EDITOR_COPY.song.newLyrics}
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex-1 divide-y overflow-y-auto">
              {entries.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyDescription>{emptyMessage}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {query && (
                      <Button
                        variant="link"
                        size="xs"
                        data-testid="song-picker-empty-import-btn"
                        disabled={lyricsImport.isSearching}
                        onClick={importLyrics}
                      >
                        <DownloadIcon />
                        {EDITOR_COPY.picker.importLyrics(query)}
                      </Button>
                    )}
                    <Button variant="link" size="xs" onClick={startCreate}>
                      <PlusIcon />
                      {EDITOR_COPY.picker.createNew(searchQuery)}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                entries.map((deck) => (
                  <SongPickerEntryRow
                    key={deck.id}
                    deck={deck}
                    isSelected={selected?.id === deck.id && mode === "browse"}
                    onSelect={() => {
                      setSelectedId(deck.id);
                      setMode("browse");
                    }}
                  />
                ))
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col bg-muted/40">
            {mode === "create" ? (
              <CreateSongForm
                initialTitle={createDraft?.title || query}
                initialArtist={createDraft?.artist}
                initialLyrics={createDraft?.lyrics}
                onCancel={() => setMode("browse")}
                onSubmit={handleCreateSubmit}
              />
            ) : mode === "import" ? (
              <div
                data-testid="song-picker-import-panel"
                className="flex flex-1 flex-col gap-3 overflow-y-auto p-6 text-xs"
              >
                <div className="border-b pb-3">
                  <h3 className="text-sm font-bold">
                    {EDITOR_COPY.lyricsImport.button}
                  </h3>
                  <p className="mt-0.5 text-muted-foreground">
                    {EDITOR_COPY.lyricsImport.source}
                  </p>
                </div>
                {lyricsImport.isSearching && (
                  <p role="status" className="text-muted-foreground">
                    {EDITOR_COPY.lyricsImport.searching}
                  </p>
                )}
                <LyricsImportResults
                  controller={lyricsImport}
                  listClassName="max-h-none"
                />
              </div>
            ) : !selected ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                {EDITOR_COPY.picker.selectSong}
              </div>
            ) : (
              <MyDeckPreview
                deck={selected}
                onAdd={() => addDeck(selected)}
                onClose={onClose}
                onEditInfo={() =>
                  setLibraryDialog({ kind: "edit", deck: selected })
                }
                onDelete={() =>
                  setLibraryDialog({ kind: "delete", deck: selected })
                }
              />
            )}
          </div>
        </div>

        {libraryDialog && (
          <LibrarySongDialog
            request={libraryDialog}
            onDone={() => setLibraryDialog(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
