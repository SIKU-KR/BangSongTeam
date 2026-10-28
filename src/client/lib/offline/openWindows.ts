import { WINDOW_COUNT_MESSAGE, WindowCountReplySchema } from "#shared";
import { navigatorApi } from "../browser/optionalApis";

/** 서비스 워커가 창 수 물음에 답하기를 기다리는 시간. 넘기면 알 수 없다고 본다 */
export const WINDOW_COUNT_TIMEOUT_MS = 1000;

async function activeWorker(): Promise<ServiceWorker | null> {
  const container = navigatorApi("serviceWorker");
  if (!container) return null;
  if (container.controller) return container.controller;
  const registration = await container.getRegistration();
  return registration?.active ?? null;
}

/**
 * 이 출처에서 열려 있는 창(탭)이 지금 몇 개인지 활성 서비스 워커에 묻는다. 이 창도 센다. 알 수
 * 없으면 `null`이다. 서비스 워커를 쓸 수 없거나, 창 목록을 읽지 못했거나, 이 물음을 담기 전 배포판의
 * 서비스 워커라 답하지 않거나, `WINDOW_COUNT_TIMEOUT_MS` 안에 답이 없거나, 답이 맞지 않는 모양일 때다.
 *
 * 창 수는 창이 어느 배포판을 돌리는지와 상관없이 센다. 옛 배포판이 연 창은 미디어 Web Lock을 쥐지
 * 않아 잠금으로는 보이지 않는다. 답이 오지 않는 것도 알 수 없는 것으로 다루므로, 호출하는 쪽은
 * `null`이면 다른 창이 있을 수 있다고 보고 조심해야 한다.
 */
export async function countOpenWindows(): Promise<number | null> {
  try {
    const worker = await activeWorker();
    if (!worker) return null;
    return await new Promise<number | null>((resolve) => {
      const channel = new MessageChannel();
      const finish = (windows: number | null): void => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(windows);
      };
      const timer = setTimeout(() => finish(null), WINDOW_COUNT_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        const reply = WindowCountReplySchema.safeParse(event.data);
        finish(reply.success ? reply.data.windows : null);
      };
      worker.postMessage({ type: WINDOW_COUNT_MESSAGE }, [channel.port2]);
    });
  } catch {
    return null;
  }
}
