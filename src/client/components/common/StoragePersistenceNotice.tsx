import React, { useState } from "react";
import { InfoIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { useStoragePersistence } from "../../lib/offline/storagePersistence";
import { COMMON_COPY } from "#copy/common";
import { SHELL_COPY } from "#copy/shell";

const DISMISS_KEY = "dismiss_storage_persistence_notice";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 브라우저가 이 사이트의 저장소를 지울 수 있을 때(영구 저장을 허락받지 못했을 때) 한 번 띄우는 안내.
 *
 * 저장 공간이 모자란 기기에서 브라우저는 영구 저장이 아닌 사이트의 IndexedDB·캐시·서비스 워커를
 * 통째로 지운다. 그러면 예배 당일 오프라인에서 앱이 뜨지 않고 올리지 못한 편집도 사라지는데,
 * 지워지기 전에는 아무 신호가 없다. 앱으로 설치하면 브라우저가 영구 저장을 허락하므로 그것을 권한다.
 * 닫으면 브라우저에 기억해 다시 띄우지 않는다.
 */
export function StoragePersistenceNotice(): React.JSX.Element | null {
  const persistence = useStoragePersistence();
  const [dismissed, setDismissed] = useState(isDismissed);

  if (persistence !== false || dismissed) return null;

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch (error) {
      void error;
    }
    setDismissed(true);
  };

  return (
    <Alert
      role="status"
      data-testid="storage-persistence-notice"
      className="shrink-0 rounded-none border-x-0 border-t-0"
    >
      <InfoIcon />
      <AlertTitle>{SHELL_COPY.storagePersistence.title}</AlertTitle>
      <AlertDescription>
        {SHELL_COPY.storagePersistence.description}
      </AlertDescription>
      <AlertAction>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDismiss}
          aria-label={SHELL_COPY.storagePersistence.dismiss}
        >
          {COMMON_COPY.close}
        </Button>
      </AlertAction>
    </Alert>
  );
}
