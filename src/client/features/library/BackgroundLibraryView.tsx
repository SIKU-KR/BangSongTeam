import React, { useEffect, useState } from "react";
import { hangulIncludes, type BackgroundMedia } from "#shared";
import {
  BackgroundPreview,
  BackgroundUploadDialog,
  useBackgroundCatalog,
} from "../backgrounds";
import { useDeleteBackground } from "../../lib/api/backgroundQueries";
import { describeApiError } from "../../lib/api/request";
import { refreshBackgroundCatalog } from "../../lib/sync/backgroundSync";
import { useIsOnline } from "../../hooks/useIsOnline";

export interface BackgroundLibraryViewProps {
  searchQuery?: string;
}

const ALL_TAGS = "전체";

function matchesQuery(bg: BackgroundMedia, query: string): boolean {
  if (!query) return true;
  return (
    hangulIncludes(bg.title, query) ||
    bg.tags.some((tag) => hangulIncludes(tag, query))
  );
}

function BackgroundCard({
  background,
  action,
}: {
  background: BackgroundMedia;
  action?: React.ReactNode;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      data-testid={`bg-card-${background.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex flex-col bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl overflow-hidden transition-all shadow-sm hover:shadow-md dark:shadow-none"
    >
      <BackgroundPreview background={background} playing={hovered} />
      <div className="p-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-bold text-zinc-900 dark:text-white truncate">
            {background.title}
          </h4>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
            {background.tags.join(" · ") || "태그 없음"}
          </p>
        </div>
        {action}
      </div>
    </div>
  );
}

function SectionHeader({
  dotClassName,
  title,
  count,
  description,
  children,
}: {
  dotClassName: string;
  title: string;
  count: number;
  description: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
      <div>
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${dotClassName}`} />
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
            {title}
          </h2>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono">
            {count}개
          </span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

function EmptyState({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="py-12 px-4 text-center flex flex-col items-center justify-center gap-3 bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm text-zinc-600 dark:text-zinc-400">
      {children}
    </div>
  );
}

/**
 * 배경 갤러리: 모든 배경을 한 격자에 보여 주고 태그와 상단 검색으로 거른다.
 * 관리자(서버가 `canManage`로 알림)에게만 올리기·삭제가 보인다.
 *
 * 곡에 배경을 입히는 것은 편집기의 배경 선택 창에서 한다. 이 화면에는 '지금 편집 중인
 * 곡'이라는 맥락이 없기 때문이다.
 */
export function BackgroundLibraryView({
  searchQuery = "",
}: BackgroundLibraryViewProps): React.JSX.Element {
  const catalog = useBackgroundCatalog();
  const isOnline = useIsOnline();
  const deleteBackground = useDeleteBackground();
  const [activeTag, setActiveTag] = useState<string>(ALL_TAGS);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BackgroundMedia | null>(
    null,
  );

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const query = searchQuery.trim();
  const all = catalog.backgrounds;
  const tags = [...new Set(all.flatMap((bg) => bg.tags))];
  const visible = all.filter(
    (bg) =>
      (activeTag === ALL_TAGS || bg.tags.includes(activeTag)) &&
      matchesQuery(bg, query),
  );

  const isOffline = !isOnline || catalog.status === "offline";
  const canManage = catalog.canManage && !isOffline;

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    try {
      await deleteBackground.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      void error;
    }
  };

  return (
    <div className="space-y-6">
      {isOffline && (
        <div
          role="status"
          className="px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300"
        >
          오프라인이라 저장해 둔 목록을 보여 줍니다.
        </div>
      )}

      <section className="space-y-4">
        <SectionHeader
          dotClassName="bg-sky-500"
          title="모든 배경"
          count={all.length}
          description="라이선스를 확인해 올린 무음 루프 영상과 이미지입니다. 마우스를 올리면 미리보기가 재생됩니다."
        >
          {catalog.canManage && (
            <button
              type="button"
              data-testid="open-bg-upload-btn"
              disabled={!canManage}
              onClick={() => setIsUploadOpen(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              배경 올리기
            </button>
          )}
        </SectionHeader>

        {tags.length > 0 && (
          <div
            data-testid="bg-tag-filter"
            className="flex items-center gap-1.5 overflow-x-auto py-1"
          >
            {[ALL_TAGS, ...tags].map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={activeTag === tag}
                onClick={() => setActiveTag(tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 cursor-pointer transition-colors ${
                  activeTag === tag
                    ? "bg-sky-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <EmptyState>
            {all.length === 0 ? (
              <p>아직 등록된 배경이 없습니다.</p>
            ) : query ? (
              <p>&ldquo;{searchQuery}&rdquo;에 맞는 배경이 없습니다.</p>
            ) : (
              <p>조건에 맞는 배경이 없습니다.</p>
            )}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {visible.map((bg) => (
              <BackgroundCard
                key={bg.id}
                background={bg}
                action={
                  catalog.canManage ? (
                    <button
                      type="button"
                      data-testid={`delete-bg-${bg.id}`}
                      disabled={!canManage}
                      onClick={() => {
                        deleteBackground.reset();
                        setPendingDelete(bg);
                      }}
                      className="px-2 py-1 rounded-lg text-[11px] font-medium shrink-0 cursor-pointer text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      삭제
                    </button>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        곡에 배경을 입히려면 편집기의 곡 속성 패널에서 &lsquo;배경 변경&rsquo;을
        누르세요.
      </p>

      <BackgroundUploadDialog
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
      />
      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bg-delete-title"
          data-testid="bg-delete-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
        >
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4 shadow-2xl text-zinc-900 dark:text-zinc-100">
            <div>
              <h3 id="bg-delete-title" className="text-sm font-bold">
                배경 삭제
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">
                {pendingDelete.title}
              </p>
            </div>
            <p className="text-xs text-zinc-700 dark:text-zinc-300">
              이 배경을 쓰는 모든 사용자의 곡이 배경 없음이 됩니다. 지운 파일은
              되살릴 수 없습니다.
            </p>
            {deleteBackground.error && (
              <p
                role="alert"
                className="text-xs text-red-600 dark:text-red-400"
              >
                {describeApiError(deleteBackground.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBackground.isPending}
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs cursor-pointer disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                data-testid="confirm-delete-bg"
                disabled={deleteBackground.isPending}
                onClick={() => void confirmDelete()}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {deleteBackground.isPending ? "지우는 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
