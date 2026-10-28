import React from "react";
import { CloudAlertIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { COMMON_COPY } from "#copy/common";

/**
 * 서버가 배경 목록을 주지 못했을 때(`error`) 갤러리와 배경 선택 창 위에 띄우는 안내.
 *
 * 비어 있거나 낡은 목록을 '아직 배경이 없어요'처럼 보이면 사용자는 배경이 없는 줄 알고
 * 넘어간다. 가진 목록은 그대로 두고, 다시 받기를 바로 누를 수 있게 한다.
 */
export function BackgroundCatalogError({
  onRetry,
}: {
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <Alert variant="destructive" data-testid="bg-catalog-error">
      <CloudAlertIcon />
      <AlertDescription>{BACKGROUND_COPY.catalogFailed}</AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          variant="outline"
          data-testid="bg-catalog-retry"
          onClick={onRetry}
        >
          {COMMON_COPY.retry}
        </Button>
      </AlertAction>
    </Alert>
  );
}
