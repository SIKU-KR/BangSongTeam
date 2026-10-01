import React, { useId, useState } from "react";
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#components/ui/field";
import { RadioGroup, RadioGroupItem } from "#components/ui/radio-group";
import { Textarea } from "#components/ui/textarea";
import type { ReportReason } from "#shared";
import { useSubmitReport } from "../../lib/api/catalogQueries";
import { describeApiError } from "../../lib/api/request";
import { SHARING_COPY } from "#copy/sharing";
import { COMMON_COPY } from "#copy/common";

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  {
    value: "lyrics_error",
    ...SHARING_COPY.report.reasons.lyrics_error,
  },
  {
    value: "correction",
    ...SHARING_COPY.report.reasons.correction,
  },
  {
    value: "inappropriate",
    ...SHARING_COPY.report.reasons.inappropriate,
  },
  {
    value: "copyright",
    ...SHARING_COPY.report.reasons.copyright,
  },
];

interface ReportDialogProps {
  onClose: () => void;
  targetId: string;
  /** 무엇을 신고하는지 보여 줄 곡 제목 */
  targetTitle: string;
  defaultReason?: ReportReason;
}

/** 신고·교정 제안 대화상자. 곡 신고만 받으며, 열려 있을 때만 마운트해서 쓴다. */
export function ReportDialog({
  onClose,
  targetId,
  targetTitle,
  defaultReason = "lyrics_error",
}: ReportDialogProps): React.JSX.Element {
  const [reason, setReason] = useState<ReportReason>(defaultReason);
  const [details, setDetails] = useState("");
  const report = useSubmitReport();
  const fieldId = useId();

  const close = (): void => {
    report.reset();
    setDetails("");
    setReason(defaultReason);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent data-testid="report-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{SHARING_COPY.report.title}</DialogTitle>
          <DialogDescription className="truncate">
            {targetTitle}
          </DialogDescription>
        </DialogHeader>

        {report.isSuccess ? (
          <>
            <p data-testid="report-dialog-done" className="text-sm">
              {SHARING_COPY.report.done}
            </p>
            <DialogFooter>
              <Button onClick={close}>{COMMON_COPY.close}</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              report.mutate({
                targetType: "deck",
                targetId,
                reason,
                details: details.trim() || undefined,
              });
            }}
          >
            <FieldSet>
              <FieldLegend variant="label">
                {SHARING_COPY.report.reason}
              </FieldLegend>
              <RadioGroup
                value={reason}
                onValueChange={(value) => setReason(value as ReportReason)}
              >
                {REASONS.map((option) => (
                  <Field key={option.value} orientation="horizontal">
                    <RadioGroupItem
                      id={`${fieldId}-${option.value}`}
                      value={option.value}
                      data-testid={`report-reason-${option.value}`}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`${fieldId}-${option.value}`}>
                        {option.label}
                      </FieldLabel>
                      <FieldDescription>{option.hint}</FieldDescription>
                    </FieldContent>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>

            <Field>
              <FieldLabel htmlFor={`${fieldId}-details`}>
                {SHARING_COPY.report.details}
              </FieldLabel>
              <Textarea
                id={`${fieldId}-details`}
                data-testid="report-details-input"
                value={details}
                maxLength={500}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                placeholder={SHARING_COPY.report.detailsPlaceholder}
              />
            </Field>

            {report.isError && (
              <FieldError>{describeApiError(report.error)}</FieldError>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {COMMON_COPY.cancel}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                data-testid="report-submit-btn"
                disabled={report.isPending}
              >
                {report.isPending
                  ? SHARING_COPY.report.pending
                  : SHARING_COPY.report.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
