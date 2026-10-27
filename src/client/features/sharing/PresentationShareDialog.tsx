import React, { useState } from "react";
import { Copy, Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import type { LinkAccess } from "#shared";
import { Button } from "#components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "#components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/ui/select";
import { Skeleton } from "#components/ui/skeleton";
import {
  useResetShareLink,
  useShareSettings,
  useUpdateShareSettings,
} from "../../lib/api/shareQueries";
import { buildShareUrl } from "./shareLink";
import { useIsOnline } from "../../hooks/useIsOnline";
import { describeApiError, ServerRejectedError } from "../../lib/api/request";
import { copyToClipboard } from "../../lib/browser/clipboard";
import { flushPendingSync } from "../../lib/sync/syncScheduler";
import { SHARING_COPY } from "#copy/sharing";
import { COMMON_COPY } from "#copy/common";

const ACCESS_OPTIONS: Array<{ value: LinkAccess; label: string }> = [
  { value: "off", label: SHARING_COPY.link.accessOptions.off },
  { value: "view", label: SHARING_COPY.link.accessOptions.view },
];

interface PresentationShareDialogProps {
  presentationId: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
}

function describeShareError(error: unknown): string {
  return error instanceof ServerRejectedError && error.status === 404
    ? SHARING_COPY.link.notSynced
    : describeApiError(error);
}

/**
 * 세트 링크 공유 설정 (Google·Canva의 SHARING_COPY.link.access와 같은 형식).
 * 링크가 켜져 있으면 로그인하지 않아도 보고 발표할 수 있고(`SharePreviewRoute`), 사본 만들기만
 * 로그인을 받는다.
 *
 * 설정을 읽기 전에 올리던 변경을 먼저 보낸다(`flushPendingSync`). 방금 만들었거나 오프라인에서
 * 만든 세트는 서버가 아직 몰라 설정을 읽을 수 없다(404). 그래도 서버에 없으면 열 수 없다고
 * 하지 않고 동기화가 끝난 뒤 다시 열라고 알린다.
 *
 * 오프라인이면 요청을 멈춰 두는 대신 온라인에서만 된다고 알리고 링크 설정을 바꾸지 못하게 한다.
 * 멈춰 둔 요청은 대화 상자를 닫은 뒤 연결이 돌아올 때 링크를 켜거나 끌 수 있다.
 */
export function PresentationShareDialog({
  presentationId,
  title,
  isOpen,
  onClose,
}: PresentationShareDialogProps): React.JSX.Element {
  const isOnline = useIsOnline();
  const settings = useShareSettings(presentationId, {
    enabled: isOpen,
    beforeFetch: flushPendingSync,
  });
  const update = useUpdateShareSettings(presentationId);
  const reset = useResetShareLink(presentationId);
  const [isResetOpen, setIsResetOpen] = useState(false);

  const access = settings.data?.access ?? "off";
  const token = settings.data?.token ?? null;
  const url = token && access !== "off" ? buildShareUrl(token) : "";
  const error = settings.error ?? update.error ?? reset.error;

  const copyLink = async (): Promise<void> => {
    try {
      await copyToClipboard(url);
      toast.success(SHARING_COPY.link.copied);
    } catch {
      toast.error(SHARING_COPY.link.copyFailed);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="share-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{COMMON_COPY.share}</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        {settings.isPending ? (
          isOnline && <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <Field>
              <FieldLabel>{SHARING_COPY.link.access}</FieldLabel>
              <Select
                items={ACCESS_OPTIONS}
                value={access}
                disabled={update.isPending || settings.isError || !isOnline}
                onValueChange={(value) => {
                  if (value && value !== access) update.mutate(value);
                }}
              >
                <SelectTrigger
                  data-testid="share-access-select"
                  aria-label={SHARING_COPY.link.access}
                  className="w-full"
                >
                  {access === "off" ? <Lock /> : <Globe />}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {SHARING_COPY.link.accessHints[access]}
              </FieldDescription>
            </Field>

            {url && (
              <Field>
                <FieldLabel>{SHARING_COPY.link.link}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    data-testid="share-link-input"
                    readOnly
                    value={url}
                    aria-label={SHARING_COPY.link.shareLink}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      data-testid="share-copy-btn"
                      onClick={() => void copyLink()}
                    >
                      <Copy />
                      {COMMON_COPY.copy}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            )}
          </>
        )}

        {!isOnline && (
          <FieldDescription>{SHARING_COPY.library.onlineOnly}</FieldDescription>
        )}
        {error && <FieldError>{describeShareError(error)}</FieldError>}

        <DialogFooter>
          {url && (
            <Button
              data-testid="share-reset-btn"
              variant="outline"
              disabled={reset.isPending}
              onClick={() => setIsResetOpen(true)}
            >
              {SHARING_COPY.link.reset}
            </Button>
          )}
          <DialogClose render={<Button />}>
            {SHARING_COPY.link.done}
          </DialogClose>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{SHARING_COPY.link.resetTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {SHARING_COPY.link.resetDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{COMMON_COPY.cancel}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="share-reset-confirm-btn"
              variant="destructive"
              onClick={() => {
                reset.mutate(undefined, {
                  onSuccess: () => toast.success(SHARING_COPY.link.regenerated),
                });
                setIsResetOpen(false);
              }}
            >
              {SHARING_COPY.link.resetConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
