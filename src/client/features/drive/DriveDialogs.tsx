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
import { canDropInto, formatLocation, type DriveItemRef } from "./driveModel";
import { itemName, parentOf } from "./driveActions";
import { FolderTree, useTreeExpansion } from "./FolderTree";
import { DRIVE_COPY } from "#copy/drive";
import { COMMON_COPY } from "#copy/common";

function closeOnDismiss(onCancel: () => void): (open: boolean) => void {
  return (open) => {
    if (!open) onCancel();
  };
}

interface NameDialogProps {
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
              aria-label={DRIVE_COPY.name}
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
              {COMMON_COPY.cancel}
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

interface ConfirmDialogProps {
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
          <AlertDialogCancel>{COMMON_COPY.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="drive-confirm-btn"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? DRIVE_COPY.deleting : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface FolderPickerDialogProps {
  title: string;
  /** 대화 상자 안내 문구 (예: 현재 위치) */
  description?: string;
  /** 고른 위치 앞에 붙는 말 (DRIVE_COPY.moveDialog.target, "만들 위치") */
  targetLabel: string;
  confirmLabel: string;
  initialFolderId: string | null;
  isDisabled?: (folderId: string | null) => boolean;
  canConfirm?: (folderId: string | null) => boolean;
  onConfirm: (folderId: string | null) => void;
  onCancel: () => void;
  testId?: string;
  confirmTestId?: string;
}

/** 폴더 트리에서 내 드라이브의 위치 하나를 고른다 (이동·사본 만들기). */
export function FolderPickerDialog({
  title,
  description,
  targetLabel,
  confirmLabel,
  initialFolderId,
  isDisabled = () => false,
  canConfirm = () => true,
  onConfirm,
  onCancel,
  testId = "folder-picker-dialog",
  confirmTestId = "folder-picker-confirm",
}: FolderPickerDialogProps): React.JSX.Element {
  const index = useFolderIndex();
  const [target, setTarget] = useState<string | null>(initialFolderId);
  const { expanded, toggle } = useTreeExpansion(target);
  const enabled = !isDisabled(target) && canConfirm(target);

  return (
    <Dialog open onOpenChange={closeOnDismiss(onCancel)}>
      <DialogContent data-testid={testId} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description && (
          <p className="truncate text-xs text-muted-foreground">
            {description}
          </p>
        )}
        <div className="max-h-72 overflow-y-auto rounded-lg border p-1.5">
          <Button
            variant="ghost"
            size="sm"
            data-testid="picker-node-root"
            aria-pressed={target === null}
            onClick={() => setTarget(null)}
            className={cn(
              "w-full justify-start",
              target === null && "bg-accent font-semibold",
            )}
          >
            <FolderIcon className="fill-current text-muted-foreground" />
            {COMMON_COPY.myDrive}
          </Button>
          <div className="pl-3.5">
            <FolderTree
              selectedId={target}
              onSelect={setTarget}
              expanded={expanded}
              onToggle={toggle}
              isDisabled={isDisabled}
            />
          </div>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {targetLabel}:{" "}
          <span className="font-semibold text-foreground">
            {formatLocation(index, target)}
          </span>
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {COMMON_COPY.cancel}
          </DialogClose>
          <Button
            data-testid={confirmTestId}
            disabled={!enabled}
            onClick={() => onConfirm(target)}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MoveDialogProps {
  refs: DriveItemRef[];
  onMove: (targetFolderId: string | null) => void;
  onCancel: () => void;
}

/**
 * 이동 대화 상자 (드라이브의 '이동').
 * 옮기는 폴더 자신과 그 하위 폴더는 고를 수 없다.
 */
export function MoveDialog({
  refs,
  onMove,
  onCancel,
}: MoveDialogProps): React.JSX.Element {
  const index = useFolderIndex();
  const origin = refs.length > 0 ? parentOf(refs[0]) : null;

  return (
    <FolderPickerDialog
      testId="drive-move-dialog"
      confirmTestId="drive-move-confirm"
      title={
        refs.length === 1
          ? DRIVE_COPY.moveDialog.title(itemName(refs[0]))
          : DRIVE_COPY.moveDialog.titleMany(refs.length)
      }
      description={DRIVE_COPY.moveDialog.currentLocation(
        formatLocation(index, origin),
      )}
      targetLabel={DRIVE_COPY.moveDialog.target}
      confirmLabel={DRIVE_COPY.move}
      initialFolderId={origin}
      isDisabled={(folderId) => !canDropInto(index, refs, folderId)}
      canConfirm={(folderId) => refs.some((ref) => parentOf(ref) !== folderId)}
      onConfirm={onMove}
      onCancel={onCancel}
    />
  );
}
