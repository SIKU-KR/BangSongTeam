import React from "react";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import { usePersistenceError, useCorruptedRecords } from "../../lib/storage";

const BANNER_CLASS =
  "flex w-full shrink-0 items-center gap-2.5 px-4 py-2.5 text-xs font-medium sm:text-sm";

/**
 * 저장 실패·저장본 격리 경고 배너.
 *
 * ChromeAlertBanner와 달리 닫을 수 없다. 사용자가 "저장됐겠지" 하고 예배 당일에
 * 작업을 잃는 것이 이 서비스에서 가장 나쁜 실패이므로, 저장이 안 되는 상태는
 * 해소될 때까지 계속 보여야 한다.
 *
 * 두 경고는 성격이 달라 따로 렌더한다. 저장 실패는 다음 저장이 성공하면 해소되지만,
 * 격리된 저장본은 저장이 잘 되더라도 그대로 남아 있다.
 */
export function StorageWarningBanner(): React.JSX.Element | null {
  const error = usePersistenceError();
  const corrupted = useCorruptedRecords();

  if (!error && corrupted.length === 0) return null;

  return (
    <>
      {error && (
        <div
          role="alert"
          data-testid="storage-warning-banner"
          className={cn(BANNER_CLASS, "bg-destructive text-white")}
        >
          <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {corrupted.length > 0 && (
        <div
          role="alert"
          data-testid="corrupted-warning-banner"
          className={cn(BANNER_CLASS, "bg-warning text-warning-foreground")}
        >
          <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>
            저장본 {corrupted.length}개를 열지 못했습니다. 삭제하지 않고 그대로
            보관해 두었으니 복구가 필요하면 문의해 주세요.
          </span>
        </div>
      )}
    </>
  );
}

export default StorageWarningBanner;
