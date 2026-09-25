import React, { useEffect, useRef, useState } from "react";
import { FolderIcon } from "lucide-react";
import { cn } from "cn";
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
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import { Input } from "#components/ui/input";
import { useFolderIndex } from "./folderStore";
import {
  canDropInto,
  formatLocation,
  ROOT_LABEL,
  type DriveItemRef,
} from "./driveModel";
import { itemName, parentOf } from "./driveActions";
import { FolderTree, useTreeExpansion } from "./FolderTree";

function closeOnDismiss(onCancel: () => void): (open: boolean) => void {
  return (open) => {
    if (!open) onCancel();
  };
}

export interface NameDialogProps {
  title: string;
  initialValue: string;
  confirmLabel: string;
  validate: (name: string) => string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** 새 폴더 / 이름 바꾸기. 열리면 이름 전체가 선택되어 바로 덮어쓸 수 있다 */
export function NameDialog({
  title,
  initialValue,
  confirmLabel,
  validate,
  onSubmit,
  onCancel,
}: NameDialogProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const error = validate(value);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Dialog open onOpenChange={closeOnDismiss(onCancel)}>
      <DialogContent data-testid="drive-name-dialog" initialFocus={inputRef}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!error) onSubmit(value.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Input
              ref={inputRef}
              type="text"
              aria-label="이름"
              aria-invalid={touched && Boolean(error)}
              data-testid="drive-name-input"
              value={value}
              maxLength={120}
              onChange={(event) => {
                setValue(event.target.value);
                setTouched(true);
              }}
            />
            {touched && error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              취소
            </DialogClose>
            <Button
              type="submit"
              data-testid="drive-name-confirm"
              disabled={Boolean(error)}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 되돌릴 수 없는 작업 확인 (영구 삭제·휴지통 비우기) */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <AlertDialog open onOpenChange={closeOnDismiss(onCancel)}>
      <AlertDialogContent data-testid="drive-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="drive-confirm-btn"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? "삭제하는 중…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface MoveDialogProps {
  refs: DriveItemRef[];
  onMove: (targetFolderId: string | null) => void;
  onCancel: () => void;
}

/**
 * 이동 대화 상자 (드라이브의 '이동'). 폴더 트리에서 옮길 곳을 고른다.
 * 옮기는 폴더 자신과 그 하위 폴더는 고를 수 없다.
 */
export function MoveDialog({
  refs,
  onMove,
  onCancel,
}: MoveDialogProps): React.JSX.Element {
  const index = useFolderIndex();
  const origin = refs.length > 0 ? parentOf(refs[0]) : null;
  const [target, setTarget] = useState<string | null>(origin);
  const { expanded, toggle } = useTreeExpansion(target);

  const isAllowed = (folderId: string | null): boolean =>
    canDropInto(index, refs, folderId);
  const changesSomething = refs.some((ref) => parentOf(ref) !== target);
  const canMove = isAllowed(target) && changesSomething;

  const title =
    refs.length === 1
      ? `‘${itemName(refs[0])}’ 이동`
      : `${refs.length}개 항목 이동`;

  return (
    <Dialog open onOpenChange={closeOnDismiss(onCancel)}>
      <DialogContent data-testid="drive-move-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="truncate text-xs text-muted-foreground">
          현재 위치: {formatLocation(index, origin)}
        </p>
        <div className="max-h-72 overflow-y-auto rounded-lg border p-1.5">
          <Button
            variant="ghost"
            size="sm"
            data-testid="picker-node-root"
            aria-selected={target === null}
            onClick={() => setTarget(null)}
            className={cn(
              "w-full justify-start",
              target === null && "bg-accent font-semibold",
            )}
          >
            <FolderIcon className="fill-current text-muted-foreground" />
            {ROOT_LABEL}
          </Button>
          <div className="pl-3.5">
            <FolderTree
              selectedId={target}
              onSelect={setTarget}
              expanded={expanded}
              onToggle={toggle}
              isDisabled={(folderId) => !isAllowed(folderId)}
            />
          </div>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          옮길 위치:{" "}
          <span className="font-semibold text-foreground">
            {formatLocation(index, target)}
          </span>
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
          <Button
            data-testid="drive-move-confirm"
            disabled={!canMove}
            onClick={() => onMove(target)}
          >
            이동
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
