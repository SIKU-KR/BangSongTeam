import React, { useState, useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "#components/ui/alert";
import { Button } from "#components/ui/button";

interface NavigatorUAData {
  brands: Array<{ brand: string; version: string }>;
  mobile: boolean;
  platform: string;
}

/** Google Chrome 데스크톱 브라우저 여부를 확인한다 */
export function isGoogleChromeBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return true;
  }

  const uaData = (navigator as unknown as { userAgentData?: NavigatorUAData })
    .userAgentData;
  if (uaData && Array.isArray(uaData.brands)) {
    const brandNames = uaData.brands.map((b) => b.brand.toLowerCase());
    const isOtherChromium = brandNames.some(
      (name) =>
        name.includes("edge") ||
        name.includes("whale") ||
        name.includes("opera") ||
        name.includes("brave") ||
        name.includes("vivaldi"),
    );
    if (isOtherChromium) {
      return false;
    }
    return brandNames.some((name) => name.includes("google chrome"));
  }

  const ua = navigator.userAgent;
  const isOther =
    ua.includes("Edg/") ||
    ua.includes("Whale/") ||
    ua.includes("OPR/") ||
    ua.includes("Firefox/") ||
    ua.includes("Brave");

  if (isOther) {
    return false;
  }

  if (ua.includes("Safari/") && !ua.includes("Chrome/")) {
    return false;
  }

  return ua.includes("Chrome/");
}

const STORAGE_KEY = "dismiss_chrome_warning";

/** 비 Chrome 브라우저 경고 배너 */
export function ChromeAlertBanner(): React.JSX.Element | null {
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    try {
      const isDismissed = localStorage.getItem(STORAGE_KEY) === "true";
      if (!isDismissed && !isGoogleChromeBrowser()) {
        setIsVisible(true);
      }
    } catch (error) {
      void error;
    }
  }, []);

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch (error) {
      void error;
    }
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Alert
      aria-label="브라우저 호환성 안내"
      className="relative z-50 shrink-0 rounded-none border-x-0 border-t-0"
    >
      <TriangleAlertIcon />
      <AlertTitle>Google Chrome 데스크톱 브라우저를 권장합니다</AlertTitle>
      <AlertDescription>
        안정적인 예배 슬라이드 송출을 위해서입니다. Safari, Edge, Whale 등에서는
        일부 기능이 제한될 수 있습니다.
      </AlertDescription>
      <AlertAction>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDismiss}
          aria-label="안내 배너 닫기"
        >
          닫기
        </Button>
      </AlertAction>
    </Alert>
  );
}
