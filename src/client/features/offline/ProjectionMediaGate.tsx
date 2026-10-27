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
 * `저장된 배경으로 시작`은 확인·받는 중에도 늘 연다. 약한 와이파이에서 받기가 느리거나
 * 멈추면, 막아 두는 동안 예배 중에 송출을 시작할 방법이 없다. 시작한 뒤에는 백그라운드
 * 큐가 남은 배경을 받고, 아직 저장하지 못한 배경은 인터넷으로 재생해 연결이 끊기면 멈출
 * 수 있다. `다시 시도`는 받지 못했을 때만 연다.
 *
 * 서비스 워커가 없어 저장할 수 없는 브라우저(`unsupported`)에는 받을 것이 없으므로 진행과
 * `다시 시도`를 보이지 않고, 인터넷으로 재생한다고 알린 뒤 `송출 시작`만 둔다. 저장 진행이나
 * '저장된 배경'을 보이면 운영자가 저장된 줄 알고 시작했다가 예배 중 연결이 끊길 때 배경을 잃는다.
 */
export function ProjectionMediaGate({
  readiness,
  onStartWithSaved,
}: {
  readiness: ProjectionMediaReadiness;
  onStartWithSaved: () => void;
}): React.JSX.Element {
  const { status, failure, readyCount, totalCount } = readiness;
  const unsupported = failure === "unsupported";
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
          <CardTitle>
            {unsupported
              ? BACKGROUND_COPY.prepare.unsupportedTitle
              : BACKGROUND_COPY.prepare.title}
          </CardTitle>
          <CardDescription role={failure ? "alert" : undefined}>
            {failure
              ? BACKGROUND_COPY.prepare.failed[failure]
              : BACKGROUND_COPY.prepare.description}
          </CardDescription>
        </CardHeader>
        {!unsupported && (
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
        )}
        <CardFooter className="flex-wrap gap-2">
          {failure && !unsupported && (
            <Button
              data-testid="projection-media-retry"
              onClick={readiness.retry}
            >
              {BACKGROUND_COPY.prepare.retry}
            </Button>
          )}
          <Button
            variant={unsupported ? "default" : "outline"}
            data-testid="projection-media-start-saved"
            title={unsupported ? undefined : BACKGROUND_COPY.prepare.savedHint}
            onClick={onStartWithSaved}
          >
            {unsupported
              ? BACKGROUND_COPY.prepare.start
              : BACKGROUND_COPY.prepare.startWithSaved}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
