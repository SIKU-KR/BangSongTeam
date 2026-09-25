import React, { useEffect, useRef, useState } from "react";
import { useFolderIndex } from "./folderStore";
import {
  canDropInto,
  formatLocation,
  ROOT_LABEL,
  type DriveItemRef,
} from "./driveModel";
import { itemName, parentOf } from "./driveActions";
import { FolderTree, useTreeExpansion } from "./FolderTree";
import { FolderGlyph } from "./icons";

function DialogShell({
  title,
  testId,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  const titleId = `${testId}-title`;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100`}
      >
        <h2 id={titleId} className="text-sm font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function DialogButtons({
  confirmLabel,
  onCancel,
  disabled,
  danger = false,
  confirmTestId,
  onConfirm,
}: {
  confirmLabel: string;
  onCancel: () => void;
  disabled?: boolean;
  danger?: boolean;
  confirmTestId: string;
  onConfirm?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer rounded-xl px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        취소
      </button>
      <button
        type={onConfirm ? "button" : "submit"}
        data-testid={confirmTestId}
        disabled={disabled}
        onClick={onConfirm}
        className={`cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${
          danger
            ? "bg-rose-600 hover:bg-rose-500"
            : "bg-emerald-600 hover:bg-emerald-500"
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  );
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
    <DialogShell title={title} testId="drive-name-dialog" onClose={onCancel}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!error) onSubmit(value.trim());
        }}
      >
        <div className="space-y-1.5">
          <input
            ref={inputRef}
            type="text"
            aria-label="이름"
            data-testid="drive-name-input"
            value={value}
            maxLength={120}
            onChange={(event) => {
              setValue(event.target.value);
              setTouched(true);
            }}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950"
          />
          {touched && error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
        </div>
        <DialogButtons
          confirmLabel={confirmLabel}
          onCancel={onCancel}
          disabled={Boolean(error)}
          confirmTestId="drive-name-confirm"
        />
      </form>
    </DialogShell>
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
    <DialogShell title={title} testId="drive-confirm-dialog" onClose={onCancel}>
      <div className="text-xs/relaxed text-zinc-600 dark:text-zinc-400">
        {message}
      </div>
      <DialogButtons
        confirmLabel={isPending ? "삭제하는 중…" : confirmLabel}
        onCancel={onCancel}
        disabled={isPending}
        danger
        confirmTestId="drive-confirm-btn"
        onConfirm={onConfirm}
      />
    </DialogShell>
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
    <DialogShell
      title={title}
      testId="drive-move-dialog"
      onClose={onCancel}
      wide
    >
      <p className="truncate text-xs text-zinc-500">
        현재 위치: {formatLocation(index, origin)}
      </p>
      <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-zinc-200 p-1.5 dark:border-zinc-800">
        <button
          type="button"
          data-testid="picker-node-root"
          aria-selected={target === null}
          onClick={() => setTarget(null)}
          className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
            target === null
              ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          <FolderGlyph className="size-4 text-emerald-500 dark:text-emerald-400" />
          <span>{ROOT_LABEL}</span>
        </button>
        <FolderTree
          selectedId={target}
          onSelect={setTarget}
          expanded={expanded}
          onToggle={toggle}
          isDisabled={(folderId) => !isAllowed(folderId)}
          baseDepth={1}
        />
      </div>
      <p className="truncate text-xs text-zinc-500">
        옮길 위치:{" "}
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
          {formatLocation(index, target)}
        </span>
      </p>
      <DialogButtons
        confirmLabel="이동"
        onCancel={onCancel}
        disabled={!canMove}
        confirmTestId="drive-move-confirm"
        onConfirm={() => onMove(target)}
      />
    </DialogShell>
  );
}
