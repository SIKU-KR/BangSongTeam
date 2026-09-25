import React, { useEffect, useMemo, useState } from "react";
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

const FILTERS: { id: FilterType; label: string; active: string }[] = [
  {
    id: "all",
    label: "전체",
    active: "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900",
  },
  { id: "mine", label: "내 곡", active: "bg-emerald-600 text-white" },
  { id: "shared", label: "공유 곡", active: "bg-indigo-600 text-white" },
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

  useEffect(() => {
    if (!isOpen || libraryDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, libraryDialog]);

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

  if (!isOpen) return null;

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="song-picker-title"
      data-testid="song-picker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative flex flex-col w-full max-w-5xl h-[88vh] max-h-[850px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2
                id="song-picker-title"
                className="text-lg font-bold text-zinc-900 dark:text-white"
              >
                찬양곡 추가
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono">
                내 곡 {mySongs.length} · 공유 {sharedCount}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              내 보관함과 다른 교회가 공유한 찬양을 검색해 세트에 추가하거나, 새
              가사를 직접 입력할 수 있습니다.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          <div className="w-full md:w-5/12 lg:w-4/12 flex flex-col border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 shrink-0 bg-white dark:bg-zinc-900">
            <div className="p-3.5 space-y-2.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  data-testid="song-picker-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="곡 제목, 아티스트, 가사 검색..."
                  className="w-full pl-3 pr-8 py-2 text-xs bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  {FILTERS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={`song-picker-filter-${option.id}`}
                      onClick={() => setFilter(option.id)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                        filter === option.id
                          ? option.active
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  data-testid="song-picker-switch-create-btn"
                  onClick={() =>
                    setMode(mode === "browse" ? "create" : "browse")
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                    mode !== "browse"
                      ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                      : "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                  }`}
                >
                  {mode !== "browse" ? "← 목록 보기" : "+ 새 가사 입력"}
                </button>
              </div>

              {serverUnavailable && (
                <p
                  data-testid="song-picker-offline-notice"
                  className="text-[11px] text-amber-700 dark:text-amber-400"
                >
                  {isOnline
                    ? "공유 라이브러리에 연결하지 못했습니다 — 내 곡만 표시합니다"
                    : "오프라인 — 내 곡만 표시합니다"}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {entries.length === 0 ? (
                <div className="p-8 text-center flex flex-col items-center justify-center gap-2.5 text-zinc-500">
                  <p className="text-xs">{emptyMessage}</p>
                  <button
                    type="button"
                    onClick={() => setMode("create")}
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer font-medium"
                  >
                    + {searchQuery ? `'${searchQuery}' ` : ""}새 곡으로 직접
                    등록하기
                  </button>
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

          <div className="flex-1 flex flex-col min-w-0 bg-zinc-50/60 dark:bg-zinc-950/40">
            {mode === "create" ? (
              <CreateSongForm
                initialTitle={searchQuery.trim()}
                onCancel={() => setMode("browse")}
                onSubmit={handleCreateSubmit}
              />
            ) : !selected ? (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs">
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
    </div>
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
      className={`p-3.5 cursor-pointer transition-colors flex flex-col gap-1 select-none ${
        isSelected
          ? "bg-emerald-50/70 dark:bg-emerald-950/40 border-l-4 border-emerald-500 pl-2.5"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-zinc-900 dark:text-white truncate">
          {title}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {entry.kind === "mine" && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              내 보관함
            </span>
          )}
          {entry.kind === "shared" && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
              {entry.ownedCopy ? "보관함에 있음" : "공유"}
            </span>
          )}
          <span className="text-[10px] text-zinc-400 font-mono">
            {entry.kind === "mine"
              ? `${entry.deck.slides.length}슬라이드`
              : `${entry.summary.forkCount}회 가져감`}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="truncate">{artist || "아티스트 미상"}</span>
        {entry.kind === "shared" && (
          <span className="truncate shrink-0">{entry.summary.authorName}</span>
        )}
      </div>

      {snippet && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5 font-light">
          {snippet}
        </p>
      )}
    </div>
  );
}
