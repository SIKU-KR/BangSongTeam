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
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import { SearchInput } from "#components/common/SearchInput";
import type { Deck } from "#shared";
import { saveSongToLibrary, useUserSongs } from "./songLibraryStore";
import { useCatalogSearch, useForkDeck } from "../../lib/api/catalogQueries";
import { describeApiError } from "../../lib/api/request";
import { useIsOnline } from "../../hooks/useIsOnline";
import { ReportDialog } from "../sharing/ReportDialog";
import {
  CreateSongForm,
  type CreateSongValues,
} from "./songPicker/CreateSongForm";
import {
  MyDeckPreview,
  SharedDeckPreview,
} from "./songPicker/SongPickerPreview";
import {
  buildPickerEntries,
  getPickerEmptyMessage,
  type PickerEntry,
  type PickerFilter,
} from "./songPicker/pickerEntries";
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

const FILTERS: { id: PickerFilter; label: string }[] = [
  { id: "all", label: EDITOR_COPY.picker.filters.all },
  { id: "mine", label: EDITOR_COPY.picker.filters.mine },
  { id: "shared", label: EDITOR_COPY.picker.filters.shared },
];

/**
 * 곡 선택 모달.
 */
export function SongPickerModal({
  isOpen,
  onClose,
  onSelectSong,
  initialMode = "browse",
}: SongPickerModalProps): React.JSX.Element | null {
  const mySongs = useUserSongs();
  const isOnline = useIsOnline();

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<PickerFilter>("all");
  const [mode, setMode] = useState<SongPickerMode>("browse");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [libraryDialog, setLibraryDialog] =
    useState<LibrarySongDialogRequest | null>(null);

  const search = useCatalogSearch(searchQuery, {
    enabled: isOpen && isOnline,
  });
  const fork = useForkDeck();

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setMode(initialMode);
      setSelectedKey(null);
      setActionError(null);
    }
  }, [isOpen, initialMode]);

  const entries = useMemo<PickerEntry[]>(
    () =>
      buildPickerEntries({
        mySongs,
        sharedDecks: search.data?.decks ?? [],
        query: searchQuery,
        filter,
      }),
    [mySongs, search.data, searchQuery, filter],
  );

  const selected =
    entries.find((entry) => entry.key === selectedKey) ?? entries[0];

  const emptyMessage = getPickerEmptyMessage({
    isFetching: search.isFetching,
    query: searchQuery,
    filter,
  });

  const addDeck = (deck: Deck): void => {
    onSelectSong(deck);
    onClose();
  };

  const handleAddSelected = async (): Promise<void> => {
    if (!selected) return;
    setActionError(null);
    try {
      if (selected.kind === "mine") {
        addDeck(selected.deck);
      } else {
        addDeck(
          selected.ownedCopy ??
            (await fork.mutateAsync(selected.summary.id)).deck,
        );
      }
    } catch (err) {
      setActionError(describeApiError(err));
    }
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

  const serverUnavailable = !isOnline || (search.isError && !search.data);
  const sharedCount = search.data?.decks.length ?? 0;
  const isAdding = fork.isPending;

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
              {EDITOR_COPY.picker.counts(mySongs.length, sharedCount)}
            </Badge>
          </div>
          <DialogDescription className="text-xs">
            {EDITOR_COPY.picker.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="flex w-full shrink-0 flex-col border-b md:w-5/12 md:border-r md:border-b-0 lg:w-4/12">
            <div className="shrink-0 space-y-2.5 border-b p-3.5">
              <SearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                label={EDITOR_COPY.picker.searchLabel}
                placeholder={EDITOR_COPY.picker.searchPlaceholder}
                testId="song-picker-search-input"
              />

              <div className="flex items-center justify-between gap-1.5">
                <ToggleGroup
                  aria-label={EDITOR_COPY.picker.kind}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={[filter]}
                  onValueChange={(next) => {
                    const picked = FILTERS.find(
                      (option) => option.id === next[0],
                    );
                    if (picked) setFilter(picked.id);
                  }}
                >
                  {FILTERS.map((option) => (
                    <ToggleGroupItem
                      key={option.id}
                      value={option.id}
                      data-testid={`song-picker-filter-${option.id}`}
                    >
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

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

              {serverUnavailable && (
                <p
                  data-testid="song-picker-offline-notice"
                  className="text-xs text-warning"
                >
                  {isOnline
                    ? EDITOR_COPY.picker.serverUnavailable
                    : EDITOR_COPY.picker.offline}
                </p>
              )}
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
                entries.map((entry) => (
                  <SongPickerEntryRow
                    key={entry.key}
                    entry={entry}
                    isSelected={
                      selected?.key === entry.key && mode === "browse"
                    }
                    onSelect={() => {
                      setSelectedKey(entry.key);
                      setActionError(null);
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
            ) : selected.kind === "mine" ? (
              <MyDeckPreview
                deck={selected.deck}
                onAdd={() => void handleAddSelected()}
                onClose={onClose}
                onEditInfo={() =>
                  setLibraryDialog({ kind: "edit", deck: selected.deck })
                }
                onDelete={() =>
                  setLibraryDialog({ kind: "delete", deck: selected.deck })
                }
              />
            ) : (
              <SharedDeckPreview
                summary={selected.summary}
                ownedCopy={selected.ownedCopy}
                isAdding={isAdding}
                error={actionError}
                onAdd={() => void handleAddSelected()}
                onClose={onClose}
                onReport={() =>
                  setReportTarget({
                    id: selected.summary.id,
                    title: selected.summary.title,
                  })
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

        {reportTarget && (
          <ReportDialog
            onClose={() => setReportTarget(null)}
            targetId={reportTarget.id}
            targetTitle={reportTarget.title}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
