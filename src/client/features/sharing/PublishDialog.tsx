import React, { useId, useState } from "react";
import { Button } from "#components/ui/button";
import { Checkbox } from "#components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import { Field, FieldError, FieldLabel } from "#components/ui/field";

export interface PublishDialogProps {
  isOpen: boolean;
  songTitle: string;
  isPending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 공개 전 저작권 안내와 동의 대화상자.
 */
export function PublishDialog({
  isOpen,
  songTitle,
  isPending,
  error,
  onConfirm,
  onCancel,
}: PublishDialogProps): React.JSX.Element | null {
  const [accepted, setAccepted] = useState(false);
  const acceptId = useId();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent data-testid="publish-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>공유 라이브러리에 공개</DialogTitle>
          <DialogDescription className="truncate">
            {songTitle}
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
          <li>
            공개하면 다른 사용자가 이 곡의 가사·슬라이드 나눔·배경·스타일을
            검색해 자기 보관함으로 가져갈 수 있습니다. 로그인하지 않은
            사람에게는 첫 슬라이드만 보입니다.
          </li>
          <li>
            가사의 저작권은 원저작자에게 있습니다. 각 교회의 저작권 라이선스(예:
            CCLI) 범위 안에서 사용해야 하며, 권리자가 요청하면 운영자가 공개를
            중단할 수 있습니다.
          </li>
          <li>
            언제든 비공개로 돌릴 수 있습니다. 다만 이미 가져간 사람의 사본은
            남습니다.
          </li>
          <li>
            내 보관함에 있는 이 곡 그대로 공개됩니다. 세트에서 고친 가사나
            서식은 들어가지 않습니다.
          </li>
        </ul>

        <Field orientation="horizontal">
          <Checkbox
            id={acceptId}
            data-testid="publish-accept-checkbox"
            checked={accepted}
            onCheckedChange={(checked) => setAccepted(checked)}
          />
          <FieldLabel htmlFor={acceptId}>위 내용을 확인했습니다</FieldLabel>
        </Field>

        {error && <FieldError>{error}</FieldError>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            data-testid="publish-confirm-btn"
            disabled={!accepted || isPending}
            onClick={onConfirm}
          >
            {isPending ? "공개하는 중…" : "공개하기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
