import React from "react";
import { usePersistenceError, useCorruptedRecords } from "../../lib/storage";

function WarningIcon(): React.JSX.Element {
  return (
    <svg
      className="w-4 h-4 shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"
      />
    </svg>
  );
}

const BANNER_CLASS =
  "w-full px-4 py-2.5 text-white text-xs sm:text-sm font-medium flex items-center gap-2.5 shrink-0";

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
          className={`${BANNER_CLASS} bg-red-600`}
        >
          <WarningIcon />
          <span>{error.message}</span>
        </div>
      )}

      {corrupted.length > 0 && (
        <div
          role="alert"
          data-testid="corrupted-warning-banner"
          className={`${BANNER_CLASS} bg-amber-600`}
        >
          <WarningIcon />
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
