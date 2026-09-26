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
import { buildShareUrl } from "../../lib/api/shareApi";
import {
  useResetShareLink,
  useShareSettings,
  useUpdateShareSettings,
} from "../../lib/api/shareQueries";
import { describeApiError } from "../../lib/api/request";
import { copyToClipboard } from "../../lib/browser/clipboard";

const ACCESS_OPTIONS: Array<{ value: LinkAccess; label: string }> = [
  { value: "off", label: "제한됨 (나만 접근)" },
  { value: "view", label: "링크가 있는 사람은 보기 가능" },
];

const ACCESS_HINTS: Record<LinkAccess, string> = {
  off: "링크를 열어도 들어올 수 없습니다.",
  view: "로그인한 사람은 보고 발표할 수 있고, 사본을 만들어 자기 세트로 고칠 수 있습니다.",
};

export interface PresentationShareDialogProps {
  presentationId: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 세트 링크 공유 설정 (Google·Canva의 "일반 액세스"와 같은 형식).
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
      toast.success("링크를 복사했습니다");
    } catch {
      toast.error("링크를 복사하지 못했습니다");
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
          <DialogTitle>공유</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        {settings.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <Field>
              <FieldLabel>일반 액세스</FieldLabel>
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
                  aria-label="일반 액세스"
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
              <FieldDescription>{ACCESS_HINTS[access]}</FieldDescription>
            </Field>

            {url && (
              <Field>
                <FieldLabel>링크</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    data-testid="share-link-input"
                    readOnly
                    value={url}
                    aria-label="공유 링크"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      data-testid="share-copy-btn"
                      onClick={() => void copyLink()}
                    >
                      <Copy />
                      복사
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
              링크 재설정
            </Button>
          )}
          <DialogClose render={<Button />}>완료</DialogClose>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>링크를 재설정할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              지금 링크는 더 이상 열리지 않고, 이 링크로 들어온 사람은 모두
              접근을 잃습니다. 새 링크를 다시 보내야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="share-reset-confirm-btn"
              variant="destructive"
              onClick={() => {
                reset.mutate(undefined, {
                  onSuccess: () => toast.success("새 링크를 만들었습니다"),
                });
                setIsResetOpen(false);
              }}
            >
              재설정
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
