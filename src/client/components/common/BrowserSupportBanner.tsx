import React, { useState, useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { getMissingCapabilities } from "../../lib/browser/capabilities";
import { SHELL_COPY } from "#copy/shell";
import { COMMON_COPY } from "#copy/common";

const STORAGE_KEY = "dismiss_browser_support_warning";

/**
 * 송출·오프라인 예배에 필요한 기능이 이 브라우저에 없을 때만 띄우는 경고 배너.
 * 브라우저 이름은 보지 않는다. 닫으면 브라우저에 기억한다.
 */
export function BrowserSupportBanner(): React.JSX.Element | null {
  const [missingLabels, setMissingLabels] = useState<string[]>([]);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") return;
    } catch (error) {
      void error;
    }
    setMissingLabels(getMissingCapabilities().map(({ label }) => label));
  }, []);

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch (error) {
      void error;
    }
    setMissingLabels([]);
  };

  if (missingLabels.length === 0) {
    return null;
  }

  return (
    <Alert
      aria-label={SHELL_COPY.browserSupport.label}
      className="relative z-50 shrink-0 rounded-none border-x-0 border-t-0"
    >
      <TriangleAlertIcon />
      <AlertTitle>{SHELL_COPY.browserSupport.title}</AlertTitle>
      <AlertDescription>
        {SHELL_COPY.browserSupport.description(missingLabels.join(", "))}
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
