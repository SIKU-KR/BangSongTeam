import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  PROJECTION_CHANNEL_NAME,
  PROJECTION_SYNC,
  type BroadcastMessage,
} from "@repo/shared";
import { useProjectionChannel } from "./useProjectionChannel";

const PRESENTATION_ID = "10000000-0000-4000-8000-000000000001";

function snapshot(): BroadcastMessage {
  return {
    type: "SYNC_SNAPSHOT",
    timestamp: Date.now(),
    payload: {
      presentationId: PRESENTATION_ID,
      currentSongIndex: 1,
      currentSlideIndex: 2,
      isBlackout: false,
      isLyricsHidden: false,
    },
  };
}

let peer: BroadcastChannel;

beforeEach(() => {
  peer = new BroadcastChannel(PROJECTION_CHANNEL_NAME);
});

afterEach(() => {
  peer.close();
  vi.useRealTimers();
});

/**
 * BroadcastChannel 전달은 마이크로태스크 밖에서 일어난다.
 * 수신이 훅 상태를 바꾸므로 act로 감싼다.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useProjectionChannel", () => {
  it("상대 창이 보낸 메시지를 검증해 전달한다", async () => {
    const onMessage = vi.fn();
    renderHook(() => useProjectionChannel({ onMessage, heartbeat: false }));

    const message = snapshot();
    peer.postMessage(message);
    await flush();

    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it("스키마를 통과하지 못한 메시지는 버린다", async () => {
    const onMessage = vi.fn();
    renderHook(() => useProjectionChannel({ onMessage, heartbeat: false }));

    peer.postMessage({ type: "NAVIGATE_SLIDE", payload: { songIndex: -1 } });
    peer.postMessage("그냥 문자열");
    peer.postMessage({ type: "UNKNOWN_KIND", timestamp: Date.now() });
    await flush();

    expect(onMessage).not.toHaveBeenCalled();
  });

  it("post로 보낸 메시지가 상대 창에 도착한다", async () => {
    const received: unknown[] = [];
    peer.onmessage = (event) => received.push(event.data);

    const { result } = renderHook(() =>
      useProjectionChannel({ heartbeat: false }),
    );

    const message: BroadcastMessage = {
      type: "SET_BLACKOUT",
      timestamp: Date.now(),
      payload: { isBlackout: true },
    };
    act(() => result.current.post(message));
    await flush();

    expect(received).toContainEqual(message);
  });

  it("메시지를 받으면 연결됨으로 본다", async () => {
    const { result } = renderHook(() =>
      useProjectionChannel({ heartbeat: false }),
    );
    expect(result.current.peerState).toBe("disconnected");

    peer.postMessage({ type: "AUDIENCE_MOUNTED", timestamp: Date.now() });

    await waitFor(() => expect(result.current.peerState).toBe("connected"));
  });

  it("상대 창 신호가 끊기면 연결 끊김으로 되돌린다", async () => {
    const { result } = renderHook(() => useProjectionChannel());

    peer.postMessage({ type: "AUDIENCE_MOUNTED", timestamp: Date.now() });
    await waitFor(() => expect(result.current.peerState).toBe("connected"));

    // 마지막 수신 시각을 타임아웃 너머로 밀어낸다.
    const past = Date.now() + PROJECTION_SYNC.AUDIENCE_TIMEOUT_MS + 1000;
    vi.spyOn(Date, "now").mockReturnValue(past);

    await waitFor(() => expect(result.current.peerState).toBe("disconnected"), {
      timeout: PROJECTION_SYNC.HEARTBEAT_INTERVAL_MS * 3,
    });
  });

  it("주기적으로 하트비트를 보낸다", async () => {
    const received: string[] = [];
    peer.onmessage = (event) => received.push(event.data?.type);

    renderHook(() => useProjectionChannel());

    await waitFor(() => expect(received).toContain("HEARTBEAT"), {
      timeout: PROJECTION_SYNC.HEARTBEAT_INTERVAL_MS * 3,
    });
  });

  it("enabled가 false면 채널을 열지 않는다", async () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useProjectionChannel({ onMessage, enabled: false, heartbeat: false }),
    );

    peer.postMessage(snapshot());
    await flush();

    expect(onMessage).not.toHaveBeenCalled();
  });

  it("BroadcastChannel이 없는 환경에서도 터지지 않는다", () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error 미지원 환경을 흉내 낸다
    delete globalThis.BroadcastChannel;

    const { result } = renderHook(() => useProjectionChannel());

    expect(result.current.isSupported).toBe(false);
    expect(() =>
      result.current.post({ type: "HEARTBEAT", timestamp: 0 }),
    ).not.toThrow();

    globalThis.BroadcastChannel = original;
  });

  it("언마운트하면 채널을 닫는다", async () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() =>
      useProjectionChannel({ onMessage, heartbeat: false }),
    );

    unmount();
    peer.postMessage(snapshot());
    await flush();

    expect(onMessage).not.toHaveBeenCalled();
  });
});
