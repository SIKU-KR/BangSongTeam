import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { cn } from "cn";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import type { Deck, PublicDeckSummary } from "#shared";
import { hangulIncludes } from "#shared";
import {
  deleteUserSong,
  saveSongToLibrary,
  updateLibrarySongInfo,
  useUserSongs,
} from "./songLibraryStore";
import { useCatalogSearch, useForkDeck } from "../../lib/api/catalogQueries";
import { describeApiError } from "../../lib/api/request";
import { useIsOnline } from "../../hooks/useIsOnline";
import { ReportDialog } from "../sharing/ReportDialog";
import { ConfirmDialog } from "../drive/DriveDialogs";
import { SongInfoDialog } from "./SongInfoDialog";
import {
  CreateSongForm,
  type CreateSongValues,
} from "./songPicker/CreateSongForm";
import {
  MyDeckPreview,
  SharedDeckPreview,
} from "./songPicker/SongPickerPreview";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

export interface SongPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSong: (deck: Deck) => void;
  initialSearch?: string;
  /** 열릴 때 보여 줄 화면. `create`는 목록을 건너뛰고 가사 직접 입력 폼을 바로 연다. */
  initialMode?: SongPickerMode;
}

export type SongPickerMode = "browse" | "create";

type FilterType = "all" | "mine" | "shared";
type LibraryDialog = { kind: "edit" | "delete"; deck: Deck };

type PickerEntry =
  | { kind: "mine"; key: string; deck: Deck }
  | {
      kind: "shared";
      key: string;
      summary: PublicDeckSummary;
      ownedCopy?: Deck;
    };

const FILTERS: { id: FilterType; label: string }[] = [
  { id: "all", label: EDITOR_COPY.picker.filters.all },
  { id: "mine", label: EDITOR_COPY.picker.filters.mine },
  { id: "shared", label: EDITOR_COPY.picker.filters.shared },
];

/**
 * 찬양곡 선택 모달.
 */
export function SongPickerModal({
  isOpen,
  onClose,
  onSelectSong,
  initialSearch = "",
  initialMode = "browse",
}: SongPickerModalProps): React.JSX.Element | null {
  const mySongs = useUserSongs();
  const isOnline = useIsOnline();

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [filter, setFilter] = useState<FilterType>("all");
  const [mode, setMode] = useState<SongPickerMode>("browse");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [libraryDialog, setLibraryDialog] = useState<LibraryDialog | null>(
    null,
  );

  const search = useCatalogSearch(searchQuery, {
    enabled: isOpen && isOnline,
  });
  const fork = useForkDeck();

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(initialSearch);
      setMode(initialMode);
      setSelectedKey(null);
      setActionError(null);
    }
  }, [isOpen, initialSearch, initialMode]);

  const entries = useMemo<PickerEntry[]>(() => {
    const q = searchQuery.trim();
    const mine: PickerEntry[] = mySongs
      .filter(
        (deck) =>
          !q ||
          hangulIncludes(deck.title, q) ||
          hangulIncludes(deck.artist ?? "", q) ||
          hangulIncludes(deck.lyricsRaw ?? "", q),
      )
      .map((deck) => ({ kind: "mine", key: `mine:${deck.id}`, deck }));

    const myIds = new Set(mySongs.map((deck) => deck.id));
    const shared: PickerEntry[] = (search.data?.decks ?? [])
      .filter((summary) => !myIds.has(summary.id))
      .map((summary) => ({
        kind: "shared",
        key: `shared:${summary.id}`,
        summary,
        ownedCopy: mySongs.find(
          (deck) => deck.origin === "fork" && deck.forkedFrom === summary.id,
        ),
      }));

    if (filter === "mine") return mine;
    if (filter === "shared") return shared;
    return [...mine, ...shared];
  }, [mySongs, search.data, searchQuery, filter]);

  const selected =
    entries.find((entry) => entry.key === selectedKey) ?? entries[0];

  const emptyMessage = useMemo(() => {
    if (search.isFetching) return EDITOR_COPY.picker.searching;
    if (searchQuery.trim()) return EDITOR_COPY.picker.noMatch;
    if (filter === "shared") return EDITOR_COPY.picker.noShared;
    if (filter === "mine") return EDITOR_COPY.picker.noMine;
    return EDITOR_COPY.picker.noSongs;
  }, [search.isFetching, searchQuery, filter]);

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
              <InputGroup>
                <InputGroupInput
                  type="text"
                  data-testid="song-picker-search-input"
                  aria-label={EDITOR_COPY.picker.searchLabel}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={EDITOR_COPY.picker.searchPlaceholder}
                />
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                {searchQuery && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={COMMON_COPY.clearSearch}
                      onClick={() => setSearchQuery("")}
                    >
                      <XIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>

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
                  <EntryRow
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

        {libraryDialog?.kind === "edit" && (
          <SongInfoDialog
            heading={EDITOR_COPY.picker.editLibraryTitle}
            initialValues={{
              title: libraryDialog.deck.title,
              artist: libraryDialog.deck.artist,
            }}
            notice={
              libraryDialog.deck.visibility === "public"
                ? EDITOR_COPY.picker.editPublicNotice
                : EDITOR_COPY.picker.editNotice
            }
            onSubmit={(values) => {
              updateLibrarySongInfo(libraryDialog.deck.id, values);
              setLibraryDialog(null);
            }}
            onCancel={() => setLibraryDialog(null)}
          />
        )}

        {libraryDialog?.kind === "delete" && (
          <ConfirmDialog
            title={EDITOR_COPY.picker.deleteTitle}
            message={
              <>
                {EDITOR_COPY.picker.deleteMessage(libraryDialog.deck.title)}
                {libraryDialog.deck.visibility === "public" &&
                  EDITOR_COPY.picker.deletePublicNote}
              </>
            }
            confirmLabel={COMMON_COPY.delete}
            onConfirm={() => {
              deleteUserSong(libraryDialog.deck.id);
              setLibraryDialog(null);
            }}
            onCancel={() => setLibraryDialog(null)}
          />
        )}

        {reportTarget && (
          <ReportDialog
            isOpen
            onClose={() => setReportTarget(null)}
            targetType="deck"
            targetId={reportTarget.id}
            targetTitle={reportTarget.title}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({
  entry,
  isSelected,
  onSelect,
}: {
  entry: PickerEntry;
  isSelected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const id = entry.kind === "mine" ? entry.deck.id : entry.summary.id;
  const title = entry.kind === "mine" ? entry.deck.title : entry.summary.title;
  const artist =
    entry.kind === "mine" ? entry.deck.artist : entry.summary.artist;
  const snippet =
    entry.kind === "mine"
      ? entry.deck.slides[0]?.lines.filter(Boolean).join(" ") ||
        entry.deck.lyricsRaw.split("\n").filter(Boolean)[0] ||
        ""
      : entry.summary.firstSlidePreview.join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      data-testid={`song-item-${id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-1 p-3.5 transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        isSelected
          ? "border-l-4 border-l-primary bg-accent pl-2.5"
          : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-bold">{title}</span>
        <div className="flex shrink-0 items-center gap-1">
          {entry.kind === "mine" && (
            <Badge variant="secondary">{EDITOR_COPY.song.myLibrary}</Badge>
          )}
          {entry.kind === "shared" && (
            <Badge variant="outline">
              {entry.ownedCopy
                ? EDITOR_COPY.picker.inLibrary
                : COMMON_COPY.share}
            </Badge>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {entry.kind === "mine"
              ? EDITOR_COPY.picker.slideCount(entry.deck.slides.length)
              : COMMON_COPY.forkCount(entry.summary.forkCount)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {artist || EDITOR_COPY.song.unknownArtist}
        </span>
        {entry.kind === "shared" && (
          <span className="shrink-0 truncate">{entry.summary.authorName}</span>
        )}
      </div>

      {snippet && (
        <p className="mt-0.5 truncate text-xs font-light text-muted-foreground">
          {snippet}
        </p>
      )}
    </div>
  );
}
