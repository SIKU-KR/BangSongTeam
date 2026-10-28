import React from "react";
import { Link2Off, Loader2 } from "lucide-react";
import { Button } from "#components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import { COMMON_COPY } from "#copy/common";
import { SHARE_LINK_COPY } from "#copy/shareLink";

/**
 * 공유 링크를 열 수 없을 때(만료·해제·오프라인) 보여 주는 안내. 잠시 뒤 되살아날 실패(오프라인·서버
 * 일시 장애)만 `onRetry`를 받아 '다시 시도'를 앞에 둔다. 링크가 해제된 실패는 다시 해도 같아서
 * 다시 시도를 두지 않는다.
 */
export function ShareLinkError({
  message,
  actionLabel,
  onAction,
  onRetry,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Empty data-testid="share-link-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2Off />
          </EmptyMedia>
          <EmptyTitle>{SHARE_LINK_COPY.unavailable}</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {onRetry && <Button onClick={onRetry}>{COMMON_COPY.retry}</Button>}
          <Button variant={onRetry ? "outline" : "default"} onClick={onAction}>
            {actionLabel}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function ShareLinkLoading(): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <p
        data-testid="share-link-loading"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="animate-spin" />
        {SHARE_LINK_COPY.opening}
      </p>
    </div>
  );
}
