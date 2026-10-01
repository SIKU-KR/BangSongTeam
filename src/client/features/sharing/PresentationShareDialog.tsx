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
import { describeApiError } from "../../lib/api/request";
import { copyToClipboard } from "../../lib/browser/clipboard";
import { SHARING_COPY } from "#copy/sharing";
import { COMMON_COPY } from "#copy/common";

const ACCESS_OPTIONS: Array<{ value: LinkAccess; label: string }> = [
  { value: "off", label: SHARING_COPY.link.accessOptions.off },
  { value: "view", label: SHARING_COPY.link.accessOptions.view },
];

export interface PresentationShareDialogProps {
  presentationId: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 세트 링크 공유 설정 (Google·Canva의 SHARING_COPY.link.access와 같은 형식).
 * 링크를 받은 사람도 로그인해야 열 수 있다 (가사 저작권 정책).
 */
export function PresentationShareDialog({
  presentationId,
  title,
  isOpen,
  onClose,
}: PresentationShareDialogProps): React.JSX.Element {
  const settings = useShareSettings(presentationId, { enabled: isOpen });
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
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <Field>
              <FieldLabel>{SHARING_COPY.link.access}</FieldLabel>
              <Select
                items={ACCESS_OPTIONS}
                value={access}
                disabled={update.isPending || settings.isError}
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

        {error && <FieldError>{describeApiError(error)}</FieldError>}

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
