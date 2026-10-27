import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";
import { createBroadcast } from "./broadcast";

const CHANNEL = "chiton:test";
const PingSchema = z.object({ userId: z.string().min(1).nullable() });

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createBroadcast", () => {
  let tabs: ReturnType<typeof installFakeBroadcastChannel>;

  beforeEach(() => {
    tabs = installFakeBroadcastChannel();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("같은 이름의 다른 인스턴스에 메시지를 전하고 보낸 인스턴스에는 돌려주지 않는다", async () => {
    const sender = createBroadcast(CHANNEL, PingSchema);
    const receiver = createBroadcast(CHANNEL, PingSchema);
    const sent = vi.fn();
    const received = vi.fn();
    sender.subscribe(sent);
    receiver.subscribe(received);

    sender.post({ userId: "a" });
    await nextTask();

    expect(received).toHaveBeenCalledExactlyOnceWith({ userId: "a" });
    expect(sent).not.toHaveBeenCalled();
    sender.close();
    receiver.close();
  });

  it("스키마에 맞지 않는 메시지는 버린다", async () => {
    const receiver = createBroadcast(CHANNEL, PingSchema);
    const received = vi.fn();
    receiver.subscribe(received);
    const other = tabs.otherTab(CHANNEL);

    other.post({ userId: 42 });
    other.post("로그아웃");
    other.post({ userId: "" });
    other.post({ userId: null });
    await nextTask();

    expect(received).toHaveBeenCalledExactlyOnceWith({ userId: null });
    receiver.close();
    other.close();
  });

  it("구독을 풀면 그 구독자에게는 더 전하지 않는다", async () => {
    const receiver = createBroadcast(CHANNEL, PingSchema);
    const kept = vi.fn();
    const dropped = vi.fn();
    receiver.subscribe(kept);
    const unsubscribe = receiver.subscribe(dropped);
    const other = tabs.otherTab(CHANNEL);

    unsubscribe();
    other.post({ userId: "a" });
    await nextTask();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
    receiver.close();
    other.close();
  });

  it("닫은 뒤에는 받지 않고, 보내도 던지지 않는다", async () => {
    const channel = createBroadcast(CHANNEL, PingSchema);
    const received = vi.fn();
    channel.subscribe(received);
    const other = tabs.otherTab(CHANNEL);

    channel.close();
    other.post({ userId: "a" });
    expect(() => channel.post({ userId: "b" })).not.toThrow();
    await nextTask();

    expect(received).not.toHaveBeenCalled();
    expect(other.received).toEqual([]);
    other.close();
  });

  it("BroadcastChannel이 없는 브라우저에서는 아무것도 하지 않는다", () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    const channel = createBroadcast(CHANNEL, PingSchema);

    expect(() => channel.post({ userId: "a" })).not.toThrow();
    const unsubscribe = channel.subscribe(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
    expect(() => channel.close()).not.toThrow();
  });

  it("채널을 열지 못하는 환경에서도 던지지 않는다", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("blocked", "SecurityError");
        }
      },
    );

    const channel = createBroadcast(CHANNEL, PingSchema);

    expect(() => channel.post({ userId: "a" })).not.toThrow();
    expect(() => channel.close()).not.toThrow();
  });
});
