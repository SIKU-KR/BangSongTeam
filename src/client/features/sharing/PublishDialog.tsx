import React, { useState } from "react";

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

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
      data-testid="publish-dialog"
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        <div>
          <h2 id="publish-dialog-title" className="text-sm font-bold">
            공유 라이브러리에 공개
          </h2>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{songTitle}</p>
        </div>

        <ul className="list-disc space-y-2 pl-4 text-xs text-zinc-700 dark:text-zinc-300">
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

        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            data-testid="publish-accept-checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 accent-emerald-600"
          />
          <span className="font-semibold">위 내용을 확인했습니다</span>
        </label>

        {error && (
          <p role="alert" className="text-xs text-rose-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-xl px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            data-testid="publish-confirm-btn"
            disabled={!accepted || isPending}
            onClick={onConfirm}
            className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "공개하는 중…" : "공개하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
