import type { z } from "zod";

export interface Broadcast<T> {
  post(message: T): void;
  subscribe(listener: (message: T) => void): () => void;
  close(): void;
}

function noBroadcast<T>(): Broadcast<T> {
  return {
    post: () => undefined,
    subscribe: () => () => undefined,
    close: () => undefined,
  };
}

function openChannel(name: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(name);
  } catch {
    return null;
  }
}

/**
 * 같은 출처의 다른 탭에 메시지를 보내고 받는 `BroadcastChannel`을 연다.
 *
 * Safari 15.4 전에는 `BroadcastChannel`이 없고, 막힌 환경에서는 채널을 열지 못한다. 그때는 보내기·
 * 받기가 모두 아무 일도 하지 않으므로, 쓰는 쪽은 다른 탭의 알림 없이도 맞게 동작해야 한다(다음
 * 요청의 401·403 확인 등). 받은 메시지는 다른 탭, 다른 배포판의 탭이 보낸 값이라 `schema`로 검사해
 * 맞지 않으면 버린다. 보낸 인스턴스는 자기 메시지를 받지 않는다.
 *
 * 인증·저장소·동기화 모듈을 가져오지 않는다. 세션 스토어와 저장소 동기화가 함께 쓰므로, 여기서
 * 그 모듈을 가져오면 순환이 생긴다.
 */
export function createBroadcast<T>(
  name: string,
  schema: z.ZodType<T>,
): Broadcast<T> {
  const channel = openChannel(name);
  if (!channel) return noBroadcast();

  const listeners = new Set<(message: T) => void>();
  const onMessage = (event: MessageEvent): void => {
    const parsed = schema.safeParse(event.data);
    if (!parsed.success) return;
    for (const listener of [...listeners]) listener(parsed.data);
  };
  channel.addEventListener("message", onMessage);

  return {
    post: (message) => {
      try {
        channel.postMessage(message);
      } catch {
        return;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      listeners.clear();
      channel.removeEventListener("message", onMessage);
      channel.close();
    },
  };
}
