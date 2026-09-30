import React from "react";
import { Button } from "#components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "#components/ui/progress";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import type { ProjectionMediaReadiness } from "./useProjectionMediaReady";

const MB = 1024 * 1024;

function megabytes(bytes: number): string {
  return BACKGROUND_COPY.prepare.megabytes(Math.round(bytes / MB));
}

/**
 * 송출 화면을 가리는 배경 준비 카드. 세트의 배경 영상을 모두 저장할 때까지 보인다.
 *
 * 받을 수 없는 경우(오프라인, 저장 공간 부족)에만 `저장된 배경으로 시작`을 연다.
 * 연결은 되는데 실패한 경우는 다시 받으면 되므로 다시 시도만 준다.
 */
export function ProjectionMediaGate({
  readiness,
  onStartWithSaved,
}: {
  readiness: ProjectionMediaReadiness;
  onStartWithSaved: () => void;
}): React.JSX.Element {
  const { status, failure, readyCount, totalCount } = readiness;
  const canStartWithSaved = failure === "offline" || failure === "quota";
  const percent =
    readiness.totalBytes > 0
      ? Math.round((readiness.receivedBytes / readiness.totalBytes) * 100)
      : 0;

  return (
    <div
      data-testid="projection-media-gate"
      className="absolute inset-0 flex items-center justify-center p-4"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{BACKGROUND_COPY.prepare.title}</CardTitle>
          <CardDescription role={failure ? "alert" : undefined}>
            {failure
              ? BACKGROUND_COPY.prepare.failed[failure]
              : BACKGROUND_COPY.prepare.description}
          </CardDescription>
        </CardHeader>
        <div className="px-(--card-spacing)">
          <Progress value={status === "checking" ? null : percent}>
            <ProgressLabel>
              {BACKGROUND_COPY.prepare.count(readyCount, totalCount)}
            </ProgressLabel>
            <ProgressValue>
              {() =>
                BACKGROUND_COPY.prepare.size(
                  megabytes(readiness.receivedBytes),
                  megabytes(readiness.totalBytes),
                )
              }
            </ProgressValue>
          </Progress>
        </div>
        {failure && (
          <CardFooter className="flex-wrap gap-2">
            <Button
              data-testid="projection-media-retry"
              onClick={readiness.retry}
            >
              {BACKGROUND_COPY.prepare.retry}
            </Button>
            {canStartWithSaved && (
              <Button
                variant="outline"
                data-testid="projection-media-start-saved"
                title={BACKGROUND_COPY.prepare.savedHint}
                onClick={onStartWithSaved}
              >
                {BACKGROUND_COPY.prepare.startWithSaved}
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
