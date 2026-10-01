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
import { Button } from "#components/ui/button";
import { Card, CardAction, CardHeader, CardTitle } from "#components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import type { BackgroundMedia } from "#shared";
import {
  BackgroundKindFilter,
  BackgroundPreview,
  filterBackgroundsByKind,
  matchesBackgroundQuery,
  useBackgroundCatalog,
  type BackgroundKindFilterValue,
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

function BackgroundCard({
  background,
  action,
}: {
  background: BackgroundMedia;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card size="sm" data-testid={`bg-card-${background.id}`} className="pt-0">
      <BackgroundPreview background={background} />
      <CardHeader>
        <CardTitle className="truncate">{background.title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
    </Card>
  );
}

/**
 * 배경 갤러리: 모든 배경을 한 격자에 보여 주고 종류(영상·이미지)와 상단 검색으로 거른다.
 * 관리자(서버가 `canManage`로 알림)에게만 삭제가 보인다. 배경 등록은
 * `scripts/importBackgrounds.mjs`로만 한다 (큰 영상은 Worker 요청 본문 한도를 넘는다).
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
  const [kind, setKind] = useState<BackgroundKindFilterValue>("all");
  const [pendingDelete, setPendingDelete] = useState<BackgroundMedia | null>(
    null,
  );

  useEffect(() => {
    void refreshBackgroundCatalog();
  }, []);

  const query = searchQuery.trim();
  const all = catalog.backgrounds;
  const visible = filterBackgroundsByKind(all, kind).filter((bg) =>
    matchesBackgroundQuery(bg, query),
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
          <AlertDescription>{BACKGROUND_COPY.offline}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        {all.length > 0 && (
          <BackgroundKindFilter value={kind} onChange={setKind} />
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
