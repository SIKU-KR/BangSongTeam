import { WINDOW_COUNT_MESSAGE } from "#shared";

interface ServiceWorkerFixtureOptions {
  /** 서비스 워커가 지금 페이지를 제어하는 중이다 */
  controlled?: boolean;
  /**
   * 서비스 워커가 '열려 있는 창이 몇 개인지' 물음(`WINDOW_COUNT_MESSAGE`)에 돌려보내는 메시지.
   * 없으면 답하지 않는다. 그 물음을 담기 전 배포판의 서비스 워커가 그렇다.
   */
  windowCountReply?: unknown;
}

/**
 * 서비스 워커를 지원하는 브라우저를 흉내 낸다. jsdom에는 `navigator.serviceWorker`가 없어서,
 * 넣지 않으면 미디어 캐시가 서비스 워커 없는 브라우저(앱 안 WebView)로 보고 배경을 받지 않는다.
 * `controlled`면 서비스 워커가 지금 페이지를 제어하는 중이다.
 */
export function installServiceWorker(
  options: ServiceWorkerFixtureOptions = {},
): void {
  const worker = {
    postMessage: (message: unknown, transfer?: MessagePort[]): void => {
      const port = transfer?.[0];
      if (
        options.windowCountReply === undefined ||
        !port ||
        (message as { type?: unknown } | null)?.type !== WINDOW_COUNT_MESSAGE
      ) {
        return;
      }
      port.postMessage(options.windowCountReply);
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      controller: options.controlled ? worker : null,
      ready: Promise.resolve(),
      getRegistration: async () => ({ active: worker }),
    },
    configurable: true,
  });
}

/** 서비스 워커를 지원하지 않는 브라우저로 되돌린다 */
export function removeServiceWorker(): void {
  Reflect.deleteProperty(navigator, "serviceWorker");
}
