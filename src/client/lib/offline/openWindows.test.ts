import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installServiceWorker,
  removeServiceWorker,
} from "../../test/serviceWorkerFixture";
import { countOpenWindows, WINDOW_COUNT_TIMEOUT_MS } from "./openWindows";

describe("countOpenWindows", () => {
  beforeEach(() => {
    removeServiceWorker();
  });

  afterEach(() => {
    removeServiceWorker();
    vi.useRealTimers();
  });

  it("서비스 워커를 쓸 수 없는 브라우저에서는 알 수 없다", async () => {
    expect(await countOpenWindows()).toBeNull();
  });

  it("이 페이지를 제어하는 서비스 워커가 답한 창 수를 돌려준다", async () => {
    installServiceWorker({
      controlled: true,
      windowCountReply: { windows: 3 },
    });

    expect(await countOpenWindows()).toBe(3);
  });

  it("이 페이지를 아직 제어하지 않아도 활성 서비스 워커에 묻는다", async () => {
    installServiceWorker({ windowCountReply: { windows: 1 } });

    expect(await countOpenWindows()).toBe(1);
  });

  it("서비스 워커가 창 목록을 읽지 못했다고 답하면 알 수 없다", async () => {
    installServiceWorker({
      controlled: true,
      windowCountReply: { windows: null },
    });

    expect(await countOpenWindows()).toBeNull();
  });

  it("이 물음을 모르는 옛 서비스 워커는 답하지 않아, 제한 시간이 지나면 알 수 없다", async () => {
    vi.useFakeTimers();
    installServiceWorker({ controlled: true });

    const counting = countOpenWindows();
    await vi.advanceTimersByTimeAsync(WINDOW_COUNT_TIMEOUT_MS - 1);
    let settled = false;
    void counting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await counting).toBeNull();
  });

  it.each([{ windows: -1 }, { windows: "2" }, {}, null, "2"])(
    "맞지 않는 답 %o는 알 수 없다",
    async (reply) => {
      installServiceWorker({ controlled: true, windowCountReply: reply });

      expect(await countOpenWindows()).toBeNull();
    },
  );

  it("서비스 워커에 보내지 못하면 알 수 없다", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        controller: {
          postMessage: () => {
            throw new DOMException("보낼 수 없음", "DataCloneError");
          },
        },
        getRegistration: async () => undefined,
      },
      configurable: true,
    });

    expect(await countOpenWindows()).toBeNull();
  });

  it("활성 서비스 워커를 알아내지 못하면 알 수 없다", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        controller: null,
        getRegistration: async () => undefined,
      },
      configurable: true,
    });

    expect(await countOpenWindows()).toBeNull();
  });
});
