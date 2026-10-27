import { vi } from "vitest";

type MessageListener = (event: MessageEvent) => void;

const openChannels = new Set<FakeBroadcastChannel>();

class FakeBroadcastChannel {
  private readonly listeners = new Set<MessageListener>();

  constructor(readonly name: string) {
    openChannels.add(this);
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: MessageListener): void {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(data: unknown): void {
    if (!openChannels.has(this)) {
      throw new DOMException("closed", "InvalidStateError");
    }
    const message = structuredClone(data);
    for (const target of openChannels) {
      if (target === this || target.name !== this.name) continue;
      queueMicrotask(() => target.deliver(message));
    }
  }

  close(): void {
    openChannels.delete(this);
  }

  private deliver(data: unknown): void {
    if (!openChannels.has(this)) return;
    const event = new MessageEvent("message", { data });
    for (const listener of this.listeners) listener(event);
  }
}

/**
 * 같은 브라우저의 다른 탭 대역. `BroadcastChannel`을 메모리 안의 가짜로 바꾼다.
 *
 * Node의 진짜 `BroadcastChannel`은 닫기 전까지 테스트 워커를 붙잡고, 같은 프로세스의 다른
 * 채널에도 메시지를 보낸다. 가짜는 브라우저처럼 보낸 인스턴스에는 돌려주지 않고, 다음
 * 마이크로태스크에 받는다. `vi.unstubAllGlobals()`로 되돌린다.
 */
export function installFakeBroadcastChannel(): {
  otherTab: (name: string) => {
    post: (data: unknown) => void;
    received: unknown[];
    close: () => void;
  };
} {
  openChannels.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  return {
    otherTab: (name) => {
      const channel = new FakeBroadcastChannel(name);
      const received: unknown[] = [];
      channel.addEventListener("message", (event) => received.push(event.data));
      return {
        post: (data) => channel.postMessage(data),
        received,
        close: () => channel.close(),
      };
    },
  };
}
