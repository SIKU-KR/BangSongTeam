import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, PlusIcon, XIcon } from "lucide-react";
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
import { Input } from "#components/ui/input";
import { IconButton } from "#components/common/IconButton";
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
  { id: "all", label: "전체" },
  { id: "mine", label: "내 곡" },
  { id: "shared", label: "공유 곡" },
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
    if (search.isFetching) return "공유 라이브러리를 검색하는 중…";
    if (searchQuery.trim()) return "일치하는 찬양곡이 없습니다.";
    if (filter === "shared") return "아직 공유된 찬양곡이 없습니다.";
    if (filter === "mine") return "보관함에 찬양곡이 없습니다.";
    return "아직 등록되거나 공유된 찬양곡이 없습니다.";
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
            <DialogTitle className="text-lg font-bold">찬양곡 추가</DialogTitle>
            <Badge variant="secondary" className="font-mono">
              내 곡 {mySongs.length} · 공유 {sharedCount}
            </Badge>
          </div>
          <DialogDescription className="text-xs">
            내 보관함과 다른 교회가 공유한 찬양을 검색해 세트에 추가하거나, 새
            가사를 직접 입력할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="flex w-full shrink-0 flex-col border-b md:w-5/12 md:border-r md:border-b-0 lg:w-4/12">
            <div className="shrink-0 space-y-2.5 border-b p-3.5">
              <div className="relative">
                <Input
                  type="text"
                  data-testid="song-picker-search-input"
                  aria-label="찬양곡 검색"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="곡 제목, 아티스트, 가사 검색..."
                  className="pr-8"
                />
                {searchQuery && (
                  <IconButton
                    label="검색어 지우기"
                    size="icon-xs"
                    onClick={() => setSearchQuery("")}
                    className="absolute top-1 right-1 text-muted-foreground"
                  >
                    <XIcon />
                  </IconButton>
                )}
              </div>

              <div className="flex items-center justify-between gap-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  {FILTERS.map((option) => (
                    <Button
                      key={option.id}
                      size="xs"
                      variant={filter === option.id ? "default" : "secondary"}
                      aria-pressed={filter === option.id}
                      data-testid={`song-picker-filter-${option.id}`}
                      onClick={() => setFilter(option.id)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>

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
                      목록 보기
                    </>
                  ) : (
                    <>
                      <PlusIcon />새 가사 입력
                    </>
                  )}
                </Button>
              </div>

              {serverUnavailable && (
                <p
                  data-testid="song-picker-offline-notice"
                  className="text-2xs text-warning"
                >
                  {isOnline
                    ? "공유 라이브러리에 연결하지 못했습니다 — 내 곡만 표시합니다"
                    : "오프라인 — 내 곡만 표시합니다"}
                </p>
              )}
            </div>

            <div className="flex-1 divide-y overflow-y-auto">
              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2.5 p-8 text-center text-muted-foreground">
                  <p className="text-xs">{emptyMessage}</p>
                  <Button
                    variant="link"
                    size="xs"
                    onClick={() => setMode("create")}
                  >
                    <PlusIcon />
                    {searchQuery ? `'${searchQuery}' ` : ""}새 곡으로 직접
                    등록하기
                  </Button>
                </div>
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
                곡을 선택해주세요.
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
            heading="보관함 곡 정보 수정"
            initialValues={{
              title: libraryDialog.deck.title,
              artist: libraryDialog.deck.artist,
            }}
            notice={
              libraryDialog.deck.visibility === "public"
                ? "공개한 곡이라 공유 라이브러리에도 바로 반영됩니다. 이미 세트에 넣은 곡은 바뀌지 않습니다."
                : "이미 세트에 넣은 곡은 바뀌지 않습니다."
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
            title="보관함에서 삭제"
            message={
              <>
                ‘{libraryDialog.deck.title}’ 곡을 내 보관함에서 삭제할까요? 이미
                세트에 넣은 곡은 그대로 남습니다.
                {libraryDialog.deck.visibility === "public" &&
                  " 공개한 곡이라 공유 라이브러리에서도 내려갑니다."}
              </>
            }
            confirmLabel="삭제"
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
      data-testid={`song-item-${id}`}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col gap-1 p-3.5 transition-colors select-none",
        isSelected
          ? "border-l-4 border-l-primary bg-accent pl-2.5"
          : "hover:bg-muted/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-bold">{title}</span>
        <div className="flex shrink-0 items-center gap-1">
          {entry.kind === "mine" && (
            <Badge variant="secondary">내 보관함</Badge>
          )}
          {entry.kind === "shared" && (
            <Badge variant="outline">
              {entry.ownedCopy ? "보관함에 있음" : "공유"}
            </Badge>
          )}
          <span className="font-mono text-2xs text-muted-foreground">
            {entry.kind === "mine"
              ? `${entry.deck.slides.length}슬라이드`
              : `${entry.summary.forkCount}회 가져감`}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="truncate">{artist || "아티스트 미상"}</span>
        {entry.kind === "shared" && (
          <span className="shrink-0 truncate">{entry.summary.authorName}</span>
        )}
      </div>

      {snippet && (
        <p className="mt-0.5 truncate text-2xs font-light text-muted-foreground">
          {snippet}
        </p>
      )}
    </div>
  );
}
