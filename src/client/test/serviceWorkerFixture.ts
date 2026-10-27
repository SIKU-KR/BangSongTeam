/**
 * 서비스 워커를 지원하는 브라우저를 흉내 낸다. jsdom에는 `navigator.serviceWorker`가 없어서,
 * 넣지 않으면 미디어 캐시가 서비스 워커 없는 브라우저(앱 안 WebView)로 보고 배경을 받지 않는다.
 * `controlled`면 서비스 워커가 지금 페이지를 제어하는 중이다.
 */
export function installServiceWorker(
  options: { controlled?: boolean } = {},
): void {
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      controller: options.controlled ? {} : null,
      ready: Promise.resolve(),
    },
    configurable: true,
  });
}

/** 서비스 워커를 지원하지 않는 브라우저로 되돌린다 */
export function removeServiceWorker(): void {
  Reflect.deleteProperty(navigator, "serviceWorker");
}
