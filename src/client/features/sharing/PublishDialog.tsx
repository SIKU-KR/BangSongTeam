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
import { SHARING_COPY } from "#copy/sharing";
import { COMMON_COPY } from "#copy/common";

interface PublishDialogProps {
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
          <DialogTitle>{SHARING_COPY.library.publish}</DialogTitle>
          <DialogDescription className="truncate">
            {songTitle}
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
          {SHARING_COPY.publishDialog.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>

        <Field orientation="horizontal">
          <Checkbox
            id={acceptId}
            data-testid="publish-accept-checkbox"
            checked={accepted}
            onCheckedChange={(checked) => setAccepted(checked)}
          />
          <FieldLabel htmlFor={acceptId}>
            {SHARING_COPY.publishDialog.accept}
          </FieldLabel>
        </Field>

        {error && <FieldError>{error}</FieldError>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {COMMON_COPY.cancel}
          </DialogClose>
          <Button
            data-testid="publish-confirm-btn"
            disabled={!accepted || isPending}
            onClick={onConfirm}
          >
            {isPending
              ? SHARING_COPY.publishDialog.pending
              : SHARING_COPY.publishDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
