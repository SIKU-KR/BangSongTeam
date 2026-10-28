import React, { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { usePersistenceError, useCorruptedRecords } from "../../lib/storage";
import { clearUnusedMediaCache } from "../../lib/offline/mediaCache";
import { SHELL_COPY } from "#copy/shell";

const BANNER_CLASS = "shrink-0 rounded-none border-x-0 border-t-0";

function ClearMediaButton(): React.JSX.Element {
  const [clearing, setClearing] = useState(false);

  const handleClick = async (): Promise<void> => {
    setClearing(true);
    const deleted = await clearUnusedMediaCache();
    setClearing(false);
    if (deleted > 0) toast.success(SHELL_COPY.storage.mediaCleared(deleted));
    else toast.info(SHELL_COPY.storage.noMediaToClear);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={clearing}
      onClick={() => void handleClick()}
    >
      {SHELL_COPY.storage.clearMedia}
    </Button>
  );
}

/**
 * 저장 실패·저장본 격리 경고 배너.
 *
 * BrowserSupportBanner와 달리 닫을 수 없다. 사용자가 "저장됐겠지" 하고 예배 당일에
 * 작업을 잃는 것이 이 서비스에서 가장 나쁜 실패이므로, 저장이 안 되는 상태는
 * 해소될 때까지 계속 보여야 한다.
 *
 * 두 경고는 성격이 달라 따로 렌더한다. 저장 실패는 저장하지 못한 항목을 모두 다시 저장하면
 * 해소된다. 다른 항목이나 다른 저장소의 저장이 성공해도 남는다. 저장소를 불러오지 못한 경고는
 * 새로고침해 다시 불러올 때까지 남는다. 격리된 저장본은 저장이 잘 되더라도 그대로 남아 있다.
 * 저장소마다 실패가 있으면 가장 나중에 난 실패를 보인다.
 *
 * 저장 공간이 가득 차 저장하지 못했으면 저장한 배경 영상을 지우는 버튼을 둔다. 오리진 용량은
 * 거의 배경 영상 캐시가 쓰므로, 이 앱 안에서 공간을 되찾는 방법은 그것뿐이다. 실패한 저장은
 * 저장소가 백오프로 다시 시도하므로, 공간이 생기면 다음 시도에서 저장하고 경고도 사라진다.
 */
export function StorageWarningBanner(): React.JSX.Element | null {
  const error = usePersistenceError();
  const corrupted = useCorruptedRecords();

  if (!error && corrupted.length === 0) return null;

  return (
    <>
      {error && (
        <Alert
          variant="destructive"
          data-testid="storage-warning-banner"
          className={BANNER_CLASS}
        >
          <TriangleAlertIcon />
          <AlertTitle>{SHELL_COPY.storage.saveFailed}</AlertTitle>
          <AlertDescription>
            {error.message}
            {error.kind === "quota" && (
              <div className="mt-2">
                <ClearMediaButton />
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {corrupted.length > 0 && (
        <Alert data-testid="corrupted-warning-banner" className={BANNER_CLASS}>
          <TriangleAlertIcon />
          <AlertTitle>
            {SHELL_COPY.storage.corrupted(corrupted.length)}
          </AlertTitle>
          <AlertDescription>
            {SHELL_COPY.storage.corruptedHint}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
