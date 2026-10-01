import React from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#components/ui/alert-dialog";
import { Button } from "#components/ui/button";
import type { BackgroundMedia } from "#shared";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { COMMON_COPY } from "#copy/common";

/**
 * 배경 삭제 확인 창. `background`가 있으면 열린다. 삭제 요청이 진행 중일 때는 닫거나
 * 취소할 수 없게 막아, 결과가 오기 전에 창이 사라져 실패를 놓치지 않게 한다.
 */
export function BackgroundDeleteDialog({
  background,
  isPending,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  background: BackgroundMedia | null;
  isPending: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <AlertDialog
      open={background !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel();
      }}
    >
      <AlertDialogContent data-testid="bg-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {BACKGROUND_COPY.library.deleteTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {BACKGROUND_COPY.library.deleteMessage(background?.title ?? "")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {COMMON_COPY.cancel}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            data-testid="confirm-delete-bg"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? BACKGROUND_COPY.library.deleting : COMMON_COPY.delete}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
