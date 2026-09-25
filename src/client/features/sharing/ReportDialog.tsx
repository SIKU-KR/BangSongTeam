import React, { useState } from "react";
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import { Label } from "#components/ui/label";
import { RadioGroup, RadioGroupItem } from "#components/ui/radio-group";
import { Textarea } from "#components/ui/textarea";
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

  const close = (): void => {
    report.reset();
    setDetails("");
    setReason(defaultReason);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent data-testid="report-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>신고하기</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {targetTitle}
          </DialogDescription>
        </DialogHeader>

        {report.isSuccess ? (
          <>
            <p data-testid="report-dialog-done" className="text-xs">
              신고가 접수되었습니다. 운영자가 확인한 뒤 처리합니다.
            </p>
            <DialogFooter>
              <Button onClick={close}>닫기</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="grid gap-4"
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
            <RadioGroup
              aria-label="신고 사유"
              value={reason}
              onValueChange={(value) => setReason(value as ReportReason)}
            >
              {REASONS.map((option) => (
                <Label
                  key={option.value}
                  className="cursor-pointer items-start text-xs font-normal"
                >
                  <RadioGroupItem
                    value={option.value}
                    data-testid={`report-reason-${option.value}`}
                    className="mt-0.5"
                  />
                  <span className="grid gap-1">
                    <span className="font-semibold">{option.label}</span>
                    <span className="text-muted-foreground">{option.hint}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>

            <Textarea
              aria-label="자세한 내용"
              data-testid="report-details-input"
              value={details}
              maxLength={500}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="자세한 내용 (선택, 500자 이내)"
              className="field-sizing-fixed resize-none text-xs md:text-xs"
            />

            {report.isError && (
              <p role="alert" className="text-xs text-destructive">
                {describeApiError(report.error)}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                취소
              </Button>
              <Button
                type="submit"
                variant="destructive"
                data-testid="report-submit-btn"
                disabled={report.isPending}
              >
                {report.isPending ? "보내는 중…" : "신고 보내기"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
