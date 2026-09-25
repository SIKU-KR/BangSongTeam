import React, { useState } from "react";
import type { ReportReason, ReportTargetType } from "#shared";
import { useSubmitReport } from "../../lib/api/catalogQueries";
import { describeApiError } from "../../lib/api/request";

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  {
    value: "lyrics_error",
    label: "가사 오류",
    hint: "틀린 가사, 빠진 절, 순서가 뒤바뀐 곳",
  },
  {
    value: "correction",
    label: "교정 제안",
    hint: "이렇게 고치면 좋겠다는 제안 (아래에 고친 가사를 적어 주세요)",
  },
  {
    value: "inappropriate",
    label: "부적절한 콘텐츠",
    hint: "찬양과 무관하거나 불쾌한 내용",
  },
  {
    value: "copyright",
    label: "저작권 게시 중단 요청",
    hint: "권리자이거나 권리자를 대리해 게시 중단을 요청합니다",
  },
];

export interface ReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  /** 무엇을 신고하는지 보여 줄 곡 제목 */
  targetTitle: string;
  defaultReason?: ReportReason;
}

/** 신고·교정 제안 대화상자. */
export function ReportDialog({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetTitle,
  defaultReason = "lyrics_error",
}: ReportDialogProps): React.JSX.Element | null {
  const [reason, setReason] = useState<ReportReason>(defaultReason);
  const [details, setDetails] = useState("");
  const report = useSubmitReport();

  if (!isOpen) return null;

  const close = (): void => {
    report.reset();
    setDetails("");
    setReason(defaultReason);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-dialog-title"
      data-testid="report-dialog"
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        <div>
          <h2 id="report-dialog-title" className="text-sm font-bold">
            신고하기
          </h2>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{targetTitle}</p>
        </div>

        {report.isSuccess ? (
          <div className="space-y-4">
            <p
              data-testid="report-dialog-done"
              className="text-xs text-emerald-700 dark:text-emerald-400"
            >
              신고가 접수되었습니다. 운영자가 확인한 뒤 처리합니다.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={close}
                className="cursor-pointer rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                닫기
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              report.mutate({
                targetType,
                targetId,
                reason,
                details: details.trim() || undefined,
              });
            }}
          >
            <fieldset className="space-y-2">
              {REASONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-2 text-xs"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={option.value}
                    data-testid={`report-reason-${option.value}`}
                    checked={reason === option.value}
                    onChange={() => setReason(option.value)}
                    className="mt-0.5 accent-rose-600"
                  />
                  <span>
                    <span className="font-semibold">{option.label}</span>
                    <span className="block text-zinc-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <textarea
              data-testid="report-details-input"
              value={details}
              maxLength={500}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="자세한 내용 (선택, 500자 이내)"
              className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-xs focus:border-rose-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
            />

            {report.isError && (
              <p role="alert" className="text-xs text-rose-600">
                {describeApiError(report.error)}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="cursor-pointer rounded-xl px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                취소
              </button>
              <button
                type="submit"
                data-testid="report-submit-btn"
                disabled={report.isPending}
                className="cursor-pointer rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {report.isPending ? "보내는 중…" : "신고 보내기"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
