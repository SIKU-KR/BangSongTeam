import React, { useState, useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "#components/ui/alert";
import { Button } from "#components/ui/button";
import {
  canMixColors,
  getMissingCapabilities,
} from "../../lib/browser/capabilities";
import { SHELL_COPY } from "#copy/shell";
import { COMMON_COPY } from "#copy/common";

const STORAGE_KEY = "dismiss_browser_support_warning";
const OUTDATED_STORAGE_KEY = "dismiss_outdated_browser_warning";

type Notice =
  { kind: "outdated" } | { kind: "missing"; labels: string[] } | null;

function isDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function findNotice(): Notice {
  if (!canMixColors()) {
    return isDismissed(OUTDATED_STORAGE_KEY) ? null : { kind: "outdated" };
  }
  if (isDismissed(STORAGE_KEY)) return null;
  const labels = getMissingCapabilities().map(({ label }) => label);
  return labels.length > 0 ? { kind: "missing", labels } : null;
}

/**
 * 이 브라우저에 맞지 않는 점이 있을 때만 띄우는 경고 배너. 브라우저 이름은 보지 않는다.
 *
 * - 색을 섞지 못하는 오래된 브라우저(`canMixColors`)면 고른 항목과 삭제 버튼 글자가 보이지 않으므로
 *   업데이트하거나 다른 브라우저로 열라고 알린다. 업데이트하면 빠진 송출 기능도 함께 생기므로 이
 *   안내 하나만 보인다.
 * - 그렇지 않으면 송출·오프라인 예배에 필요한 기능 가운데 빠진 것을 알린다.
 *
 * 닫으면 브라우저에 기억한다. 두 안내는 따로 기억해, 한쪽을 닫았다고 다른 쪽을 숨기지 않는다.
 */
export function BrowserSupportBanner(): React.JSX.Element | null {
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    setNotice(findNotice());
  }, []);

  if (notice === null) {
    return null;
  }

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(
        notice.kind === "outdated" ? OUTDATED_STORAGE_KEY : STORAGE_KEY,
        "true",
      );
    } catch (error) {
      void error;
    }
    setNotice(null);
  };

  return (
    <Alert
      aria-label={SHELL_COPY.browserSupport.label}
      className="relative z-50 shrink-0 rounded-none border-x-0 border-t-0"
    >
      <TriangleAlertIcon />
      <AlertTitle>
        {notice.kind === "outdated"
          ? SHELL_COPY.browserSupport.outdated.title
          : SHELL_COPY.browserSupport.title}
      </AlertTitle>
      <AlertDescription>
        {notice.kind === "outdated"
          ? SHELL_COPY.browserSupport.outdated.description
          : SHELL_COPY.browserSupport.description(notice.labels.join(", "))}
      </AlertDescription>
      <AlertAction>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDismiss}
          aria-label={SHELL_COPY.browserSupport.dismiss}
        >
          {COMMON_COPY.close}
        </Button>
      </AlertAction>
    </Alert>
  );
}
