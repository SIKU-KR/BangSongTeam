import React, { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#components/ui/alert-dialog";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
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
      className="flex flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm transition-all hover:shadow-md"
    >
      <BackgroundPreview background={background} playing={hovered} />
      <div className="flex items-center justify-between gap-2 border-t p-3">
        <div className="min-w-0">
          <h4 className="truncate text-xs font-bold">{background.title}</h4>
          <p className="mt-0.5 truncate text-2xs text-muted-foreground">
            {background.tags.join(" · ") || "태그 없음"}
          </p>
        </div>
        {action}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count: number;
  description: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col justify-between gap-3 border-b pb-3 sm:flex-row sm:items-end">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <Badge variant="secondary" className="font-mono">
            {count}개
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
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
          className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs text-warning"
        >
          오프라인이라 저장해 둔 목록을 보여 줍니다.
        </div>
      )}

      <section className="space-y-4">
        <SectionHeader
          title="모든 배경"
          count={all.length}
          description="라이선스를 확인해 올린 무음 루프 영상과 이미지입니다. 마우스를 올리면 미리보기가 재생됩니다."
        >
          {catalog.canManage && (
            <Button
              data-testid="open-bg-upload-btn"
              disabled={!canManage}
              onClick={() => setIsUploadOpen(true)}
            >
              배경 올리기
            </Button>
          )}
        </SectionHeader>

        {tags.length > 0 && (
          <div
            data-testid="bg-tag-filter"
            className="flex items-center gap-1.5 overflow-x-auto py-1"
          >
            {[ALL_TAGS, ...tags].map((tag) => (
              <Button
                key={tag}
                size="xs"
                variant={activeTag === tag ? "default" : "secondary"}
                aria-pressed={activeTag === tag}
                onClick={() => setActiveTag(tag)}
                className="shrink-0 rounded-full px-2.5"
              >
                {tag}
              </Button>
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((bg) => (
              <BackgroundCard
                key={bg.id}
                background={bg}
                action={
                  catalog.canManage ? (
                    <Button
                      variant="destructive"
                      size="xs"
                      data-testid={`delete-bg-${bg.id}`}
                      disabled={!canManage}
                      onClick={() => {
                        deleteBackground.reset();
                        setPendingDelete(bg);
                      }}
                    >
                      삭제
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-2xs text-muted-foreground">
        곡에 배경을 입히려면 편집기의 곡 속성 패널에서 &lsquo;배경 변경&rsquo;을
        누르세요.
      </p>

      <BackgroundUploadDialog
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
      />
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBackground.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent data-testid="bg-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>배경 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              ‘{pendingDelete?.title}’ — 이 배경을 쓰는 모든 사용자의 곡이 배경
              없음이 됩니다. 지운 파일은 되살릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteBackground.error && (
            <p role="alert" className="text-xs text-destructive">
              {describeApiError(deleteBackground.error)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBackground.isPending}>
              취소
            </AlertDialogCancel>
            <Button
              variant="destructive"
              data-testid="confirm-delete-bg"
              disabled={deleteBackground.isPending}
              onClick={() => void confirmDelete()}
            >
              {deleteBackground.isPending ? "지우는 중…" : "삭제"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
