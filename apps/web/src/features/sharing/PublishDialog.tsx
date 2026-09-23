import React, { useState } from "react";

export interface PublishDialogProps {
  isOpen: boolean;
  songTitle: string;
  /** 보관함 원본이 이미 있어 그 내용이 세트 곡 내용으로 바뀐다 */
  overwritesLibraryCopy: boolean;
  /** 가사 라이브러리 루트 버전이 될 수 있는 곡인가 (포크본·대표 가사 곡은 아니다) */
  canContribute: boolean;
  defaultContribute: boolean;
  isPending: boolean;
  error: string | null;
  onConfirm: (options: { contributeToCatalog: boolean }) => void;
  onCancel: () => void;
}

/**
 * 공개 전 저작권 안내와 동의 (PRD 4.7 공유 선택, 6.6, 9장 '공개 시 안내 동의').
 *
 * 동의 체크 없이는 공개 버튼이 눌리지 않는다. 서버도 동의가 `true` 리터럴이
 * 아니면 거절한다.
 */
export function PublishDialog({
  isOpen,
  songTitle,
  overwritesLibraryCopy,
  canContribute,
  defaultContribute,
  isPending,
  error,
  onConfirm,
  onCancel,
}: PublishDialogProps): React.JSX.Element | null {
  const [accepted, setAccepted] = useState(false);
  const [contribute, setContribute] = useState(defaultContribute);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
      data-testid="publish-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60"
    >
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-5 space-y-4 text-zinc-900 dark:text-zinc-100">
        <div>
          <h2 id="publish-dialog-title" className="text-sm font-bold">
            공유 라이브러리에 공개
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{songTitle}</p>
        </div>

        <ul className="text-xs text-zinc-700 dark:text-zinc-300 space-y-2 list-disc pl-4">
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
          {overwritesLibraryCopy && (
            <li className="text-amber-700 dark:text-amber-400">
              내 보관함의 &lsquo;{songTitle}&rsquo;이 지금 세트의 내용으로
              바뀝니다.
            </li>
          )}
        </ul>

        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            data-testid="publish-accept-checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 accent-emerald-600"
          />
          <span className="font-semibold">위 내용을 확인했습니다</span>
        </label>

        {canContribute && (
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              data-testid="publish-contribute-checkbox"
              checked={contribute}
              onChange={(e) => setContribute(e.target.checked)}
              className="mt-0.5 accent-emerald-600"
            />
            <span>
              <span className="font-semibold">가사 라이브러리에도 기여</span>
              <span className="block text-zinc-500">
                같은 곡을 등록한 사람들의 가사를 모아 대표 가사를 만듭니다.
              </span>
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="text-xs text-rose-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            data-testid="publish-confirm-btn"
            disabled={!accepted || isPending}
            onClick={() =>
              onConfirm({ contributeToCatalog: canContribute && contribute })
            }
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer"
          >
            {isPending ? "공개하는 중…" : "공개하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
