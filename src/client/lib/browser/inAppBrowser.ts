/** 앱 안에서 링크를 열어 주는 브라우저(WebView)가 속한 앱. 이름을 알 수 없으면 `webview`다 */
export type InAppBrowser =
  | "kakaotalk"
  | "naver"
  | "band"
  | "instagram"
  | "facebook"
  | "line"
  | "webview";

const APP_TOKENS: ReadonlyArray<readonly [InAppBrowser, RegExp]> = [
  ["kakaotalk", /KAKAOTALK/i],
  ["naver", /NAVER\(inapp/i],
  ["band", /\bBAND\//i],
  ["instagram", /\bInstagram\b/i],
  ["facebook", /\b(?:FBAN|FBAV|FB_IAB)\b/],
  ["line", /\bLine\//i],
  ["webview", /; wv\)/],
];

/**
 * 사용자 에이전트가 앱 안 브라우저면 그 앱을, 아니면 null을 돌려준다.
 *
 * Google은 앱 안 브라우저의 로그인을 `disallowed_useragent`로 막는다. 앱이 사용자 에이전트에
 * 남기는 이름과 Android WebView 표시(`; wv)`)만 보고, Safari 표시가 없다는 이유로는 짐작하지
 * 않는다. 짐작하면 홈 화면에 추가한 iOS 앱과 Safari 안의 화면까지 막게 된다.
 */
export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  for (const [browser, token] of APP_TOKENS) {
    if (token.test(userAgent)) return browser;
  }
  return null;
}

/**
 * 같은 주소(`href`)를 기기의 브라우저로 다시 여는 주소. 믿을 만한 방법이 없는 앱이면 null이다.
 *
 * 카카오톡의 `kakaotalk://web/openExternal`과 LINE의 `openExternalBrowser=1`만 앱이 직접 받아
 * 기본 브라우저로 넘겨 준다. 그 밖의 앱은 `intent:` 같은 주소를 막거나 무시하고, 앱이 받아 주지
 * 않으면 iOS의 앱 안 브라우저에서 Safari를 열 방법도 없다. 눌러도 아무 일도 없는 버튼보다 링크
 * 복사 안내가 낫다.
 *
 * Google 주소가 아니라 이 앱의 주소를 연다. Better Auth가 로그인 시작 때 심은 state 쿠키는
 * 시작한 브라우저의 쿠키 저장소에만 있어서, 거기서 시작한 로그인은 다른 브라우저로 이어지지 않는다.
 */
export function externalBrowserUrl(
  browser: InAppBrowser,
  href: string,
): string | null {
  switch (browser) {
    case "kakaotalk":
      return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
    case "line": {
      const url = new URL(href);
      url.searchParams.set("openExternalBrowser", "1");
      return url.toString();
    }
    default:
      return null;
  }
}
