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
import { ImageIcon, WifiOffIcon } from "lucide-react";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
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
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { COMMON_COPY } from "#copy/common";

export interface BackgroundLibraryViewProps {
  searchQuery?: string;
}

const ALL_TAGS = COMMON_COPY.all;

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
    <Card
      size="sm"
      data-testid={`bg-card-${background.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="pt-0"
    >
      <BackgroundPreview background={background} playing={hovered} />
      <CardHeader>
        <CardTitle className="truncate">{background.title}</CardTitle>
        <CardDescription className="truncate">
          {background.tags.join(" · ") || BACKGROUND_COPY.library.noTags}
        </CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
    </Card>
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
            {BACKGROUND_COPY.library.count(count)}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
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
        <Alert role="status">
          <WifiOffIcon />
          <AlertDescription>{BACKGROUND_COPY.library.offline}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <SectionHeader
          title={BACKGROUND_COPY.library.title}
          count={all.length}
          description={BACKGROUND_COPY.library.description}
        >
          {catalog.canManage && (
            <Button
              data-testid="open-bg-upload-btn"
              disabled={!canManage}
              onClick={() => setIsUploadOpen(true)}
            >
              {BACKGROUND_COPY.upload}
            </Button>
          )}
        </SectionHeader>

        {tags.length > 0 && (
          <ToggleGroup
            data-testid="bg-tag-filter"
            aria-label={BACKGROUND_COPY.library.tags}
            variant="outline"
            size="sm"
            value={[activeTag]}
            onValueChange={(next) => setActiveTag(next[0] ?? ALL_TAGS)}
            className="flex-wrap"
          >
            {[ALL_TAGS, ...tags].map((tag) => (
              <ToggleGroupItem key={tag} value={tag}>
                {tag}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        {visible.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImageIcon />
              </EmptyMedia>
              <EmptyTitle>
                {all.length === 0
                  ? BACKGROUND_COPY.noBackgrounds
                  : query
                    ? BACKGROUND_COPY.library.noMatch(searchQuery)
                    : BACKGROUND_COPY.library.noFilterMatch}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
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
                      {COMMON_COPY.delete}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-2xs text-muted-foreground">
        {BACKGROUND_COPY.library.applyHint}
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
            <AlertDialogTitle>
              {BACKGROUND_COPY.library.deleteTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {BACKGROUND_COPY.library.deleteMessage(
                pendingDelete?.title ?? "",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteBackground.error && (
            <p role="alert" className="text-xs text-destructive">
              {describeApiError(deleteBackground.error)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBackground.isPending}>
              {COMMON_COPY.cancel}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              data-testid="confirm-delete-bg"
              disabled={deleteBackground.isPending}
              onClick={() => void confirmDelete()}
            >
              {deleteBackground.isPending
                ? BACKGROUND_COPY.library.deleting
                : COMMON_COPY.delete}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
