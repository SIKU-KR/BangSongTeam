import { describe, it, expect } from "vitest";
import {
  detectInAppBrowser,
  externalBrowserUrl,
  type InAppBrowser,
} from "./inAppBrowser";

const IOS_WEBKIT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36";

const IN_APP_USER_AGENTS: Array<[string, InAppBrowser, string]> = [
  ["카카오톡 iOS", "kakaotalk", `${IOS_WEBKIT} KAKAOTALK 10.9.5`],
  ["카카오톡 Android", "kakaotalk", `${ANDROID_WEBVIEW};KAKAOTALK 2410960`],
  [
    "네이버 앱 iOS",
    "naver",
    `${IOS_WEBKIT} NAVER(inapp; search; 1000; 12.9.2; 15PRO)`,
  ],
  [
    "네이버 앱 Android",
    "naver",
    `${ANDROID_WEBVIEW} NAVER(inapp; search; 1000; 12.9.2)`,
  ],
  ["밴드 iOS", "band", `${IOS_WEBKIT} Safari/604.1 BAND/13.5.0`],
  ["밴드 Android", "band", `${ANDROID_WEBVIEW} BAND/13.5.0`],
  [
    "인스타그램 iOS",
    "instagram",
    `${IOS_WEBKIT} Instagram 342.0.0.37.76 (iPhone14,2; iOS 17_5_1; ko_KR; ko; scale=3.00; 1170x2532; 628294889)`,
  ],
  [
    "페이스북 iOS",
    "facebook",
    `${IOS_WEBKIT} [FBAN/FBIOS;FBAV/460.0.0.46.108;FBBV/588103404;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1;FBSS/3;FBID/phone;FBLC/ko_KR;FBOP/5]`,
  ],
  [
    "페이스북 Android",
    "facebook",
    `${ANDROID_WEBVIEW} [FB_IAB/FB4A;FBAV/460.0.0.43.109;]`,
  ],
  ["라인 iOS", "line", `${IOS_WEBKIT} Safari Line/14.8.0`],
  ["라인 Android", "line", `${ANDROID_WEBVIEW} Line/14.8.0/IAB`],
  ["알 수 없는 앱의 Android WebView", "webview", ANDROID_WEBVIEW],
];

const BROWSER_USER_AGENTS: Array<[string, string]> = [
  [
    "데스크톱 Chrome",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  ],
  [
    "Android Chrome",
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  ],
  [
    "Android 삼성 인터넷",
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  ],
  [
    "iOS Safari",
    `${IOS_WEBKIT.replace("Mobile/15E148", "Version/17.5.1 Mobile/15E148")} Safari/604.1`,
  ],
  [
    "iOS Chrome",
    IOS_WEBKIT.replace(
      "Mobile/15E148",
      "CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
    ),
  ],
  ["iOS 홈 화면 앱", IOS_WEBKIT],
  [
    "데스크톱 Safari",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  ],
  [
    "Firefox",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  ],
  ["빈 값", ""],
];

describe("detectInAppBrowser", () => {
  it.each(IN_APP_USER_AGENTS)(
    "%s의 앱 안 브라우저를 알아본다",
    (_, expected, userAgent) => {
      expect(detectInAppBrowser(userAgent)).toBe(expected);
    },
  );

  it.each(BROWSER_USER_AGENTS)(
    "%s는 앱 안 브라우저로 보지 않는다",
    (_, userAgent) => {
      expect(detectInAppBrowser(userAgent)).toBeNull();
    },
  );

  it("앱 이름이 있으면 Android WebView 표시보다 앱을 먼저 알린다", () => {
    expect(detectInAppBrowser(`${ANDROID_WEBVIEW};KAKAOTALK 2410960`)).toBe(
      "kakaotalk",
    );
  });
});

describe("externalBrowserUrl", () => {
  const page = "https://example.com/s/token?copy=1";

  it("카카오톡은 같은 주소를 다른 브라우저로 여는 주소를 준다", () => {
    expect(externalBrowserUrl("kakaotalk", page)).toBe(
      `kakaotalk://web/openExternal?url=${encodeURIComponent(page)}`,
    );
  });

  it("라인은 기존 쿼리를 지키며 외부 브라우저 표시를 붙인다", () => {
    expect(externalBrowserUrl("line", page)).toBe(
      "https://example.com/s/token?copy=1&openExternalBrowser=1",
    );
    expect(
      externalBrowserUrl("line", "https://example.com/presentations"),
    ).toBe("https://example.com/presentations?openExternalBrowser=1");
  });

  it.each(["naver", "band", "instagram", "facebook", "webview"] as const)(
    "%s는 믿을 만한 방법이 없어 주소를 주지 않는다",
    (browser) => {
      expect(externalBrowserUrl(browser, page)).toBeNull();
    },
  );
});
