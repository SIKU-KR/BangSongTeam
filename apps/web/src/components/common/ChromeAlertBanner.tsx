import React, { useState, useEffect } from "react";

interface NavigatorUAData {
  brands: Array<{ brand: string; version: string }>;
  mobile: boolean;
  platform: string;
}

export function isGoogleChromeBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return true;
  }

  // 1. Try User-Agent Client Hints (Modern Chromium)
  const uaData = (navigator as unknown as { userAgentData?: NavigatorUAData }).userAgentData;
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

  // 2. Fallback to navigator.userAgent string
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

  // Safari check (Safari has 'Safari' but NOT 'Chrome')
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) {
    return false;
  }

  // Pure Chrome contains 'Chrome/' and not other browser identifiers
  return ua.includes("Chrome/");
}

const STORAGE_KEY = "dismiss_chrome_warning";

export function ChromeAlertBanner(): React.JSX.Element | null {
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    try {
      const isDismissed = localStorage.getItem(STORAGE_KEY) === "true";
      if (!isDismissed && !isGoogleChromeBrowser()) {
        setIsVisible(true);
      }
    } catch {
      // Ignore localStorage access restrictions
    }
  }, []);

  const handleDismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignore
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
      className="relative z-50 flex items-center justify-between bg-amber-500 text-zinc-950 px-4 py-2 text-sm font-medium shadow-sm transition-all"
    >
      <div className="flex items-center gap-2">
        <span className="text-base" aria-hidden="true">
          ⚠️
        </span>
        <span>
          안정적인 예배 슬라이드 송출을 위해 <strong>Google Chrome</strong> 데스크톱 브라우저 사용을 권장합니다. (Safari, Edge, Whale 등에서는 일부 기능이 제한될 수 있습니다.)
        </span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="안내 배너 닫기"
        className="ml-4 shrink-0 rounded px-2 py-0.5 text-xs font-semibold bg-zinc-950/10 hover:bg-zinc-950/20 active:bg-zinc-950/30 transition-colors cursor-pointer"
      >
        닫기
      </button>
    </aside>
  );
}
