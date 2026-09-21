import React from "react";
import { usePersistenceError } from "../../lib/storage";

/**
 * 저장 실패 경고 배너.
 *
 * ChromeAlertBanner와 달리 닫을 수 없다. 사용자가 "저장됐겠지" 하고 예배 당일에
 * 작업을 잃는 것이 이 서비스에서 가장 나쁜 실패이므로, 저장이 안 되는 상태는
 * 해소될 때까지 계속 보여야 한다.
 */
export function StorageWarningBanner(): React.JSX.Element | null {
  const error = usePersistenceError();
  if (!error) return null;

  return (
    <div
      role="alert"
      data-testid="storage-warning-banner"
      className="w-full px-4 py-2.5 bg-red-600 text-white text-xs sm:text-sm font-medium flex items-center gap-2.5 shrink-0"
    >
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
      <span>{error.message}</span>
    </div>
  );
}

export default StorageWarningBanner;
