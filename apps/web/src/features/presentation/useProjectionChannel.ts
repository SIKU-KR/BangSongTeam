import { useCallback, useEffect, useRef, useState } from "react";
import {
  BroadcastMessageSchema,
  PROJECTION_CHANNEL_NAME,
  PROJECTION_SYNC,
  type BroadcastMessage,
} from "@repo/shared";

/**
 * 조작 창(Controller) ↔ 송출 창(Audience) 동기화 채널 (TECH_SPEC 5.3).
 *
 * BroadcastChannel은 같은 브라우저·같은 오리진 안에서만 오가므로 네트워크가
 * 끊겨도 동작한다 (PRD 6.2). 예배 중 두 창이 어긋나면 그대로 사고이므로,
 * 들어온 메시지는 반드시 스키마로 검증하고 실패한 것은 조용히 버린다 —
 * 옛 버전이 열려 있는 다른 탭이 보낸 메시지로 송출이 깨지면 안 된다.
 */

export type ProjectionPeerState = "connected" | "disconnected";

export interface UseProjectionChannelOptions {
  /** 검증을 통과한 메시지만 전달된다 */
  onMessage?: (message: BroadcastMessage) => void;
  /** 상대 창에게 살아 있음을 알린다 (조작 창·송출 창 모두 보낸다) */
  heartbeat?: boolean;
  enabled?: boolean;
}

export interface UseProjectionChannelReturn {
  post: (message: BroadcastMessage) => void;
  /** 상대 창에서 마지막 신호를 받은 뒤 흐른 시간으로 판정한다 */
  peerState: ProjectionPeerState;
  isSupported: boolean;
}

function isSupported(): boolean {
  return typeof BroadcastChannel !== "undefined";
}

export function useProjectionChannel(
  options: UseProjectionChannelOptions = {},
): UseProjectionChannelReturn {
  const { onMessage, heartbeat = true, enabled = true } = options;

  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastSeenRef = useRef<number>(0);
  const [peerState, setPeerState] =
    useState<ProjectionPeerState>("disconnected");

  // 콜백을 ref에 담아 두면 매 렌더마다 채널을 다시 열지 않아도 된다.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const supported = isSupported();

  useEffect(() => {
    if (!enabled || !supported) return;

    const channel = new BroadcastChannel(PROJECTION_CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent) => {
      const parsed = BroadcastMessageSchema.safeParse(event.data);
      if (!parsed.success) return;

      lastSeenRef.current = Date.now();
      setPeerState("connected");
      onMessageRef.current?.(parsed.data);
    };

    return () => {
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
    };
  }, [enabled, supported]);

  // 하트비트 송신 + 상대 창 생존 판정.
  useEffect(() => {
    if (!enabled || !supported || !heartbeat) return;

    const timer = setInterval(() => {
      channelRef.current?.postMessage({
        type: "HEARTBEAT",
        timestamp: Date.now(),
      } satisfies BroadcastMessage);

      const silence = Date.now() - lastSeenRef.current;
      if (
        lastSeenRef.current === 0 ||
        silence > PROJECTION_SYNC.AUDIENCE_TIMEOUT_MS
      ) {
        setPeerState("disconnected");
      }
    }, PROJECTION_SYNC.HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [enabled, supported, heartbeat]);

  const post = useCallback((message: BroadcastMessage) => {
    channelRef.current?.postMessage(message);
  }, []);

  return { post, peerState, isSupported: supported };
}
