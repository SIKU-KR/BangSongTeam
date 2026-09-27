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
import { SHARE_LINK_COPY } from "#copy/shareLink";

/** 공유 링크를 열 수 없을 때(만료·해제·오프라인) 보여 주는 안내 */
export function ShareLinkError({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Empty data-testid="share-link-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2Off />
          </EmptyMedia>
          <EmptyTitle>{SHARE_LINK_COPY.unavailable}</EmptyTitle>
          <EmptyDescription>{message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onAction}>{actionLabel}</Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

export function ShareLinkLoading(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
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
