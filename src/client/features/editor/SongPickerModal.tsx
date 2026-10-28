import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
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

/**
 * 곡 선택 모달. 내 보관함 곡만 검색어로 로컬에서 걸러 보여 주고, 새 가사를 입력하면
 * 보관함에 저장한 뒤 바로 프레젠테이션에 넣는다.
 */
export function SongPickerModal({
  isOpen,
  onClose,
  onSelectSong,
  initialMode = "browse",
}: SongPickerModalProps): React.JSX.Element | null {
  const mySongs = useUserSongs();

  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<SongPickerMode>("browse");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryDialog, setLibraryDialog] =
    useState<LibrarySongDialogRequest | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setMode(initialMode);
      setSelectedId(null);
    }
  }, [isOpen, initialMode]);

  const entries = useMemo<Deck[]>(() => {
    const q = searchQuery.trim();
    return q ? mySongs.filter((deck) => deckMatchesQuery(deck, q)) : mySongs;
  }, [mySongs, searchQuery]);

  const selected = entries.find((deck) => deck.id === selectedId) ?? entries[0];

  const emptyMessage = searchQuery.trim()
    ? EDITOR_COPY.picker.noMatch
    : EDITOR_COPY.picker.noSongs;

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
                  variant={mode === "browse" ? "outline" : "secondary"}
                  data-testid="song-picker-switch-create-btn"
                  onClick={() =>
                    setMode(mode === "browse" ? "create" : "browse")
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
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => setMode("create")}
                    >
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
                initialTitle={searchQuery.trim()}
                onCancel={() => setMode("browse")}
                onSubmit={handleCreateSubmit}
              />
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
