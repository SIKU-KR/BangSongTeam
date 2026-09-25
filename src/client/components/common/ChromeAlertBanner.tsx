import React, { useState, useEffect } from "react";

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
    <aside
      role="alert"
      aria-label="브라우저 호환성 안내"
      className="relative z-50 flex items-center justify-between bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 shadow-sm transition-all"
    >
      <div className="flex items-center gap-2">
        <span className="text-base" aria-hidden="true">
          ⚠️
        </span>
        <span>
          안정적인 예배 슬라이드 송출을 위해 <strong>Google Chrome</strong>{" "}
          데스크톱 브라우저 사용을 권장합니다. (Safari, Edge, Whale 등에서는
          일부 기능이 제한될 수 있습니다.)
        </span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="안내 배너 닫기"
        className="ml-4 shrink-0 cursor-pointer rounded-sm bg-zinc-950/10 px-2 py-0.5 text-xs font-semibold transition-colors hover:bg-zinc-950/20 active:bg-zinc-950/30"
      >
        닫기
      </button>
    </aside>
  );
}
